from __future__ import annotations

import json
import sys
import threading
import time
from importlib.resources import files
from typing import Optional

import frida
from rich.console import Console
from rich.live import Live
from rich.text import Text

from .._version import __version__ as frooky_version
from .config import load_hook_configs, load_user_scripts
from .device import attach_or_spawn, describe_target, detect_platform, get_device, get_device_frida_version
from .messages import create_message_handler
from .options import RunnerOptions
from .output import OutputWriter
from .watcher import HookFileWatcher


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
        self._console = Console(stderr=False)
        self._live = Live("", console=self._console, refresh_per_second=4, transient=False)
        self._live.start()
        self._stop_event = threading.Event()
        self._stop_reason: Optional[str] = None
        self._crash = None

    def _stop_live_terminal(self):
        self._live.stop()

    def _on_session_detached(self, reason: str, crash) -> None:
        """Called by Frida (on its own thread) when the session to the target is lost."""
        if self._stop_reason is not None:
            return
        self._stop_reason = reason
        self._crash = crash
        self._stop_event.set()

    def _describe_stop_reason(self) -> str:
        if self._crash is not None:
            return f"process crashed ({self._crash.summary})"
        if self._stop_reason == "user interrupt":
            return "stopped by user (Ctrl+C)"
        if self._stop_reason:
            return self._stop_reason[0].upper() + self._stop_reason[1:].replace("-", " ")
        return "stopped"

    def _exit_code_for_stop_reason(self) -> int:
        return 0 if self._stop_reason in (None, "user interrupt") else 1

    def _print_summary(self) -> None:
        print()
        print(f"  Stopped: {self._describe_stop_reason()}")
        print(f"  Events captured: {self.output.event_count:,}")
        print(f"  Output written to: {self.options.output_path}")
        print()

    def _update_status_line(self) -> None:
        max_event_len = 60
        event_display = self.output.last_event[:max_event_len]
        if len(self.output.last_event) > max_event_len:
            event_display += "..."

        status = f"  Events: {self.output.event_count:,}  |  Last: {event_display}"
        self._live.update(Text(status, style="reverse"))

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
        target_info = {
            "Device": self.device.name + (f" ({self.device.id})" if self.device.id else ""),
            "Target": describe_target(self.device, self.options),
        }
        output_info = {
            "Hook files": str(len(self.options.hook_paths)) + (" (watching for changes)" if self.options.watch else ""),
            "Output": str(self.options.output_path),
        }

        info = [
            f"Frooky v{frooky_version}",
            "",
            *fmt_group(frida_versions),
            "",
            *fmt_group(target_info),
            "",
            *fmt_group(output_info),
        ]

        logo_width = max(len(line) for line in logo)

        lines = [""]
        for i in range(max(len(logo), len(info))):
            logo_part = logo[i].ljust(logo_width) if i < len(logo) else " " * logo_width
            info_part = info[i] if i < len(info) else ""
            lines.append(f"{logo_part}   {info_part}")

        lines.append("")
        lines.append("  Press Ctrl+C to stop...")
        lines.append("")

        print("\n".join(lines))
        self._update_status_line()

    def _apply_hook_file_changes(self, watcher: HookFileWatcher) -> None:
        """Send changed hook files to the agent, which re-hooks only what changed."""
        for path, hook_config in watcher.poll():
            print(f"  Hook file changed, updating hooks: {path}")
            self.script.exports_sync.update_frooky_config(str(path), hook_config)

    def run(self) -> int:
        """Run the Frooky hooks."""
        try:
            self.output.truncate()

            self.device = get_device(self.options)
            self.platform = detect_platform(self.device)

            self.session, self.spawned_pid = attach_or_spawn(self.device, self.options)
            self.session.on("detached", self._on_session_detached)
            self.device_frida_version = get_device_frida_version(self.session)

            script_path = files("frooky") / "agent" / "dist" / f"agent-{self.platform}.js"
            script_source = script_path.read_text(encoding="utf-8")

            self._print_header()

            # Load any user-provided scripts before the frooky agent
            self.user_scripts = load_user_scripts(self.session, self.options.user_scripts)

            self.script = self.session.create_script(script_source)
            self.script.on("message", create_message_handler(self.output, self.options.print_events, self._update_status_line))
            self.script.load()

            if self.options.agent_option_verbose:
                log_level = "info"
            elif self.options.agent_option_very_verbose:
                log_level = "debug"
            else:
                log_level = "warn"
            self.script.exports_sync.init_frooky_agent(log_level, "console", self.options.agent_option_resolver_timeout)

            watcher = HookFileWatcher(self.options.hook_paths) if self.options.watch else None
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
                if watcher:
                    self._apply_hook_file_changes(watcher)

        except KeyboardInterrupt:
            print("\b\b  ", end="", flush=True)
            self._stop_reason = "user interrupt"

        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            self._stop_reason = f"error: {e}"

        finally:
            if self.script:
                try:
                    self.script.unload()
                except Exception:
                    pass
            for script in self.user_scripts:
                try:
                    script.unload()
                except Exception:
                    pass
            if self.session:
                try:
                    self.session.detach()
                except Exception:
                    pass
            self._stop_live_terminal()
            self._print_summary()

        return self._exit_code_for_stop_reason()
