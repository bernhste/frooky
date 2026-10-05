from __future__ import annotations

import json
import threading
import time
from importlib.resources import files
from pathlib import Path
from typing import Optional

import frida
from rich.text import Text

from .._version import __version__ as frooky_version
from .config import load_hook_config, load_hook_configs, load_user_scripts
from .device import attach_or_spawn, choose_device, describe_target, detect_platform, get_device, get_device_frida_version
from .feed import LEVEL_STYLES, Feed, HookStatus
from .keys import KeyListener
from .messages import create_log_handler, create_message_handler
from .options import RunnerOptions
from .output import OutputWriter
from .watcher import HookFileWatcher, describe_reload_error

# How long unloading the scripts and detaching may take. Both need the agent, which never responds again when the app
# deadlocks inside a hook. Under heavy load, a normal stop takes up to ~8 s, plus 1 to 3 s for prepareDetach().
DETACH_TIMEOUT_SECONDS = 13.0


class FrookyRunner:
    """Runs Frooky hooks using Frida."""

    def __init__(self, options: RunnerOptions):
        self.options = options
        self.session: Optional[frida.core.Session] = None
        self.script: Optional[frida.core.Script] = None
        self.user_scripts: list[frida.core.Script] = []
        self.device: Optional[frida.core.Device] = None
        self.platform: Optional[str] = None
        self.spawned_pid: Optional[int] = None
        self.device_frida_version: Optional[str] = None
        self.output = OutputWriter(options.output_path)
        self.feed = Feed()
        self._hook_status = HookStatus()
        self.feed.start()
        self._stop_event = threading.Event()
        self._stop_reason: Optional[str] = None
        self._crash = None
        # the agent's report of a native exception that likely killed the process; Frida's crash is empty on Android
        self._agent_crash: Optional[dict] = None
        self._reload_requested = threading.Event()
        self._statistics_requested = threading.Event()
        self._print_events = options.print_events
        self._key_listener = KeyListener(self._on_key)

    def _choose_device(self, devices: list[frida.core.Device]) -> frida.core.Device:
        with self.feed.paused():
            return choose_device(devices)

    def _stop_live_terminal(self):
        self.feed.stop()

    def _on_session_detached(self, reason: str, crash) -> None:
        """Called by Frida (on its own thread) when the session to the target is lost."""
        if self._stop_reason is not None:
            return
        self._stop_reason = reason
        self._crash = crash
        self._stop_event.set()

    def _on_key(self, key: str) -> None:
        """Called on the key listener thread for every key press."""
        if key in ("r", "R"):
            self._reload_requested.set()
        elif key in ("s", "S"):
            self._statistics_requested.set()
        elif key in ("e", "E"):
            self._print_events = not self._print_events
            self.feed.log("info", f"Printing events {'enabled' if self._print_events else 'disabled'}")

    def _print_hook_statistics(self) -> None:
        try:
            statistics = self.script.exports_sync.hook_statistics()
        except Exception as e:
            self.feed.log("error", f"Failed to read the hook statistics: {e}")
            return
        self.feed.hook_statistics(statistics)

    def _on_progress(self, progress: dict) -> None:
        """Called on Frida's thread with the agent's hook resolving progress, shown in the status bar."""
        was_busy = self._hook_status.busy
        self._hook_status.update(int(progress.get("hooked", 0)), int(progress.get("resolving", 0)), int(progress.get("notFound", 0)), int(progress.get("waiting", 0)))
        # without a terminal there is no status bar, so say it once in the feed; the integration tests wait for it
        if was_busy and not self._hook_status.busy and not self.feed.console.is_terminal:
            self.feed.log("info", self._hook_status.describe())

    def _on_agent_crash(self, crash: dict) -> None:
        """Called on Frida's thread when the agent reports a native exception it expects to be fatal."""
        self._agent_crash = crash

    def _on_reload_error(self, path: Path, error: Exception) -> None:
        self.feed.log("warn", describe_reload_error(path, error))

    def _describe_stop_reason(self) -> str:
        if self._crash is not None:
            return f"process crashed ({self._crash.summary})"
        # only trusted once the process is gone: the agent cannot know whether the app survives the exception
        if self._agent_crash is not None and self._stop_reason == "process-terminated":
            return f"process crashed ({self._agent_crash.get('type')} at {self._agent_crash.get('address')})"
        if self._stop_reason == "user interrupt":
            return "stopped by user (Ctrl+C)"
        if self._stop_reason and self._stop_reason.startswith("error: "):
            return "E" + self._stop_reason[1:]
        if self._stop_reason:
            # Frida's reasons, e.g. `process-terminated`
            return self._stop_reason[0].upper() + self._stop_reason[1:].replace("-", " ")
        return "stopped"

    def _exit_code_for_stop_reason(self) -> int:
        return 0 if self._stop_reason in (None, "user interrupt") else 1

    def _crash_details(self) -> list[Text]:
        """Lines explaining a crash of the target, for the summary: first the hook it crashed in, then the backtrace."""
        if self._stop_reason != "process-terminated":
            return []
        lines = []
        crash = self._agent_crash
        if crash:
            backtrace = crash.get("backtrace") or []
            crashed_in = list(dict.fromkeys(frame["hook"] for frame in backtrace if frame.get("hook")))
            native_hooks = crash.get("nativeHooks") or []
            if crashed_in:
                lines.append(Text.assemble("  Crashed in hooked function: ", (", ".join(crashed_in), f"bold {LEVEL_STYLES['error']}")))
            elif native_hooks:
                lines.append(
                    Text.assemble(
                        "  No hooked function on the crashing stack, but hooks in its modules: ",
                        (", ".join(native_hooks), f"bold {LEVEL_STYLES['warn']}"),
                    )
                )
            if crashed_in or native_hooks:
                lines.append(Text("    A hook at a wrong offset or with wrong params can corrupt the app's code or data.", style="dim"))
            if backtrace:
                lines.append(Text("  Backtrace:"))
                lines.extend(_format_crash_frame(frame) for frame in backtrace)
        if self.platform == "android":
            # also after a Java crash, which the agent does not see as a native exception
            crashed = self._crash is not None or self._agent_crash is not None
            hint = "For the full crash report" if crashed else "If the app crashed, for the crash report"
            lines.append(Text(f"  {hint} run: adb logcat -d -b crash", style="dim"))
            if not crashed:
                # the system kills an app that doesn't respond, e.g. when hooks slow down its startup too much
                lines.append(Text("  If the app stopped responding (ANR), run: adb logcat -d -b events | grep am_anr", style="dim"))
        return lines

    def _print_summary(self) -> None:
        self.feed.print()
        reason = self._describe_stop_reason()
        crashed = reason.startswith("process crashed")
        self.feed.print(Text.assemble("  Stopped: ", (reason, f"bold {LEVEL_STYLES['error']}" if crashed else "")))
        for line in self._crash_details():
            self.feed.print(line)
        self.feed.print(f"  Events captured: {self.output.event_count:,}")
        self.feed.print(f"  Output written to: {self.options.output_path}")
        self.feed.print()

    def _update_status_line(self) -> None:
        # not truncated here: the status bar crops itself to the terminal width on every redraw
        self.feed.status(self.output.event_count, self.output.last_event)

    def _print_header(self) -> None:
        """Print the Frooky header with session information."""

        agent_frida_version_path = files("frooky") / "agent" / "dist" / "version.json"
        agent_frida_version_json = json.loads(agent_frida_version_path.read_text(encoding="utf-8"))
        agent_frida_version = str(agent_frida_version_json["frida"])

        logo = [
            "   ___    ____           ",
            "  / __\\  / _  |    _     _    _  _   _   _",
            " / _\\   | (_) |  / _ \\ / _ \\ | / /  | | | |",
            "/ /     / / | | | (_) | (_) ||  <   | |_| |",
            "\\/     /_/  |_|  \\___/ \\___/ |_|\\_\\  \\__, |",
            "                                     |___/",
            "",
            "  .------.      .-------.      .------.",
            "  | YAML |----->| FRIDA |----->| JSON |",
            "  '------'      '-------'      '------'",
        ]

        def fmt_version(v: Optional[str]) -> str:
            return v if v in (None, "unknown") else f"v{v}"

        def fmt_group(group: dict) -> list[str]:
            width = max(len(label) + 1 for label in group) + 1
            return [f"{(label + ':').ljust(width)}{value}" for label, value in group.items()]

        frida_versions = {
            "Frida host": fmt_version(frida.__version__),
            "Frida device": fmt_version(self.device_frida_version),
            "Frida agent": fmt_version(agent_frida_version),
        }
        session_info = {
            "Device": self.device.name + (f" ({self.device.id})" if self.device.id else ""),
            "Target": describe_target(self.device, self.options),
            "Output": str(self.options.output_path),
            # no runtime means Frida's default, QuickJS
            "Runtime": {"qjs": "QuickJS", "v8": "V8"}[self.options.runtime or "qjs"],
            "Keys": "R reload  S stats  E events  ^C stop" if self._key_listener.active else "^C stop",
        }
        # one group so the values share a column, with Keys set apart by an empty line
        *session_lines, keys_line = fmt_group(session_info)

        info = [
            f"Frooky v{frooky_version}",
            "",
            *fmt_group(frida_versions),
            "",
            *session_lines,
            "",
            keys_line,
        ]

        logo_width = max(len(line) for line in logo)

        lines = [""]
        for i in range(max(len(logo), len(info))):
            logo_part = logo[i].ljust(logo_width) if i < len(logo) else " " * logo_width
            info_part = info[i] if i < len(info) else ""
            lines.append(f"{logo_part}   {info_part}")

        lines.append("")

        self.feed.print("\n".join(lines))
        self._update_status_line()

    def _apply_hook_file_changes(self, watcher: HookFileWatcher) -> None:
        """Send changed hook files to the agent, which re-hooks only what changed and reports the result."""
        for path, hook_config in watcher.poll():
            self.feed.log("info", f"Change detected in {path.name}, updating hooks...")
            self.script.exports_sync.update_frooky_config(str(path), hook_config)

    def _reload_hook_files(self, watcher: Optional[HookFileWatcher]) -> None:
        """Reload every hook file and retry the hooks that were not found; installed, unchanged hooks stay."""
        self.feed.log("info", "Reloading hook files and retrying hooks that were not found...")
        if watcher:
            watcher.poll()
            reloaded = watcher.current()
        else:
            reloaded = []
            for path in dict.fromkeys(self.options.hook_paths):
                try:
                    reloaded.append((path, load_hook_config(path)))
                except Exception as e:
                    self._on_reload_error(path, e)
        for path, hook_config in reloaded:
            self.script.exports_sync.update_frooky_config(str(path), hook_config, True)

    def _detach(self) -> bool:
        """Unload the scripts and detach from the target. False if that didn't finish within DETACH_TIMEOUT_SECONDS
        or was interrupted with Ctrl+C."""

        def detach() -> None:
            if self.script:
                try:
                    # unhooks what the unload can't remove safely, see FrookyAgent.prepareDetach()
                    self.script.exports_sync.prepare_detach()
                except Exception:
                    pass
            for script in [self.script, *self.user_scripts]:
                if script:
                    try:
                        script.unload()
                    except Exception:
                        pass
            if self.session:
                try:
                    self.session.detach()
                except Exception:
                    pass

        # a daemon thread, as a deadlocked agent never lets it finish
        thread = threading.Thread(target=detach, name="frooky-detach", daemon=True)
        thread.start()
        try:
            thread.join(DETACH_TIMEOUT_SECONDS)
        except KeyboardInterrupt:
            pass
        return not thread.is_alive()

    def run(self) -> int:
        """Run the Frooky hooks."""
        try:
            self.output.truncate()
            self.output.open()

            self.device = get_device(self.options, choose=self._choose_device)
            self.platform = detect_platform(self.device)

            self.session, self.spawned_pid = attach_or_spawn(self.device, self.options)
            self.session.on("detached", self._on_session_detached)
            self.device_frida_version = get_device_frida_version(self.session)

            script_path = files("frooky") / "agent" / "dist" / f"agent-{self.platform}.js"
            script_source = script_path.read_text(encoding="utf-8")

            self._key_listener.start()
            self._print_header()
            self.feed.hook_status(self._hook_status)

            # Load any user-provided scripts before the frooky agent
            self.user_scripts = load_user_scripts(self.session, self.options.user_scripts, self.feed, self.options.runtime, platform=self.platform)

            self.script = self.session.create_script(script_source, runtime=self.options.runtime)
            self.script.on(
                "message",
                create_message_handler(
                    self.output,
                    self.feed,
                    lambda: self._print_events,
                    on_progress=self._on_progress,
                    on_crash=self._on_agent_crash,
                    on_batch=self._update_status_line,
                ),
            )
            self.script.set_log_handler(create_log_handler(self.feed))
            self.script.load()

            self.script.exports_sync.init_frooky_agent(self.options.agent_log_level, "console")

            watcher = HookFileWatcher(self.options.hook_paths, self._on_reload_error) if self.options.watch else None
            hook_configs = watcher.configs if watcher else load_hook_configs(self.options.hook_paths)
            # the file paths identify the configs, so the agent can replace them when a file changes
            config_ids = [str(path) for path in self.options.hook_paths]
            self.script.exports_sync.load_frooky_configs(hook_configs, config_ids)

            if self.options.spawn:
                self.device.resume(self.spawned_pid)

            # Woken either by Ctrl+C (KeyboardInterrupt, below) or by _on_session_detached
            # firing because we lost the connection to the target/agent.
            while not self._stop_event.is_set():
                time.sleep(0.5)
                if self._statistics_requested.is_set():
                    self._statistics_requested.clear()
                    self._print_hook_statistics()
                if self._reload_requested.is_set():
                    self._reload_requested.clear()
                    self._reload_hook_files(watcher)
                elif watcher:
                    self._apply_hook_file_changes(watcher)

        except KeyboardInterrupt:
            print("\b\b  ", end="", flush=True)
            self._stop_reason = "user interrupt"

        except Exception as e:
            self.feed.log("error", f"Error: {e}")
            self._stop_reason = f"error: {e}"

        finally:
            self._key_listener.stop()
            if not self._detach():
                self.feed.log(
                    "warn",
                    f"The agent didn't respond within {DETACH_TIMEOUT_SECONDS:g} s, e.g. because the app hangs inside a hook. Stopped without detaching; restart the app if it stays frozen.",
                )
            self.output.close()
            self._stop_live_terminal()
            self._print_summary()

        return self._exit_code_for_stop_reason()


def _format_crash_frame(frame: dict) -> Text:
    """A backtrace frame such as `0x7ea6c5247803 libfoo.so!Java_Foo_bar+0x43`, highlighted if it lies in a hooked function."""
    address, _, location = str(frame.get("frame", "")).partition(" ")
    module, _, symbol = location.partition("!")
    hook = frame.get("hook")
    if hook:
        style = f"bold {LEVEL_STYLES['error']}"
        return Text.assemble("  → ", (f"{address} {location}", style), (f"  ← hook {hook}", style))
    return Text.assemble("    ", (address, "dim"), " ", (module, LEVEL_STYLES["info"]), ("!", "dim"), symbol)
