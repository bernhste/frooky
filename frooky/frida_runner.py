from __future__ import annotations

import json
import logging
import sys
import time
from dataclasses import dataclass, field
from importlib.resources import files
from pathlib import Path
from typing import Optional

import frida
import yaml
from rich.console import Console
from rich.live import Live
from rich.text import Text

from frooky.pp_hook_event import pp_hook_event

from ._version import __version__ as frooky_version

logger = logging.getLogger(__name__)


@dataclass
class RunnerOptions:
    """Options for the FrookyRunner."""

    hook_paths: list[Path]
    output_path: Path
    device_id: Optional[str] = None
    use_usb: bool = False
    remote: bool = False
    host: Optional[str] = None
    certificate: Optional[str] = None
    attach_frontmost: bool = False
    attach_name: Optional[str] = None
    attach_identifier: Optional[str] = None
    attach_pid: Optional[int] = None
    spawn: Optional[str] = None
    user_scripts: list[Path] = field(default_factory=list)
    agent_option_verbose: bool = False
    agent_option_very_verbose: bool = False
    agent_option_resolver_timeout: Optional[int] = None
    print_events: bool = False


class FrookyRunner:
    """Runs Frooky hooks using Frida."""

    SUPPORTED_PLATFORMS = ("android", "ios")

    def __init__(self, options: RunnerOptions):
        self.options = options
        self.session: Optional[frida.core.Session] = None
        self.script: Optional[frida.core.Script] = None
        self.user_scripts: list[frida.core.Script] = []
        self.device: Optional[frida.core.Device] = None
        self.platform: Optional[str] = None
        self.spawned_pid: Optional[int] = None
        self.event_count: int = 0
        self.last_event: str = "Waiting for events..."
        self.total_hooks: Optional[int] = None
        self.total_errors: int = 0
        self._console = Console(stderr=False)
        self._live = Live("", console=self._console, refresh_per_second=4, transient=False)
        self._live.start()

    def _stop_live_terminal(self):
        self._live.stop()

    def _update_status_line(self) -> None:
        max_event_len = 60
        event_display = self.last_event[:max_event_len]
        if len(self.last_event) > max_event_len:
            event_display += "..."

        status = f"  Events: {self.event_count:,}  |  Last: {event_display}"
        self._live.update(Text(status, style="reverse"))

    def _prepare_targets(self) -> dict:
        """Load hook JSON files and merge their category and hooks into a single target."""
        hook_configs = []

        for hook_path in self.options.hook_paths:
            with open(hook_path, "r", encoding="utf-8") as f:
                if Path(hook_path).suffix in (".yaml", ".yml"):
                    hook_data = yaml.safe_load(f)
                else:
                    logger.warning("%s is in JSON format, which is deprecated. Please migrate to YAML.", Path(hook_path).name)
                    hook_data = json.load(f)

                hook_configs.append(hook_data)

        return hook_configs

    def _create_message_handler(self) -> None:
        """Create a message handler closure with access to output path."""
        output_path = self.options.output_path

        def on_message(message, data):
            if message.get("type") != "send":
                print("MSG", message)
                return

            payload = message.get("payload")

            if isinstance(payload, dict) or isinstance(payload, list):
                with open(output_path, "a", encoding="utf-8") as f:
                    json.dump(payload, f)
                    f.write("\n")

                for event in payload:
                    self.event_count += 1
                    if event.get("symbol"):
                        self.last_event = f"{event.get('module')}: {event.get('symbol')}"
                    elif event.get("method"):
                        self.last_event = f"{event.get('javaClassName')}.{event.get('method')}"
                    self._update_status_line()

                    if self.options.print_events:
                        pp_hook_event(event)
            else:
                try:
                    parsed = json.loads(payload)
                    with open(output_path, "a", encoding="utf-8") as f:
                        json.dump(parsed, f)
                        f.write("\n")

                    if isinstance(parsed, dict):
                        event_type = parsed.get("type")

                        if event_type == "summary":
                            self.total_hooks = parsed.get("totalHooks", 0)
                            self.total_errors = parsed.get("totalErrors", 0)
                        elif event_type in ("hook", "native-hook", "objc-hook"):
                            self.event_count += 1
                            method = parsed.get("method", parsed.get("symbol", "unknown"))
                            class_name = parsed.get("class", "")
                            if class_name:
                                self.last_event = f"{class_name}.{method}"
                            else:
                                self.last_event = method
                            self._update_status_line()
                except Exception:
                    print("MSG", payload)

        return on_message

    def _get_target_description(self) -> str:
        """Get a description of the target for the header."""
        opts = self.options

        if opts.attach_frontmost:
            app = self.device.get_frontmost_application()
            if app:
                return f"frontmost application: {app.name} (PID: {app.pid})"
            return "frontmost application"
        elif opts.attach_name:
            return opts.attach_name
        elif opts.attach_identifier:
            return opts.attach_identifier
        elif opts.attach_pid:
            return str(opts.attach_pid)
        elif opts.spawn:
            return f"{opts.spawn} (spawned)"
        return "unknown target"

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

        info = [
            f"v{frooky_version} - Powered by Frida {frida.__version__}",
            f"Agent compiled with Frida {agent_frida_version}",
            f"Target: {self._get_target_description()}",
            "",
            f"Device: {self.device.name}" + (f" ({self.device.id})" if self.device.id else ""),
            f"Platform: {self.platform}",
            f"Hook files: {len(self.options.hook_paths)}",
            f"Output: {self.options.output_path}",
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

    def _get_device(self) -> frida.core.Device:
        """Get the Frida device based on options."""
        opts = self.options

        if opts.device_id:
            return frida.get_device(opts.device_id, timeout=5)
        elif opts.host:
            return frida.get_device_manager().add_remote_device(opts.host, certificate=opts.certificate)
        elif opts.remote:
            return frida.get_remote_device()
        elif opts.use_usb:
            return frida.get_usb_device(timeout=5)
        else:
            return frida.get_local_device()

    def _detect_platform(self) -> str:
        """Detect the target platform (android/ios) from the connected device."""
        params = self.device.query_system_parameters()
        os_id = params.get("os", {}).get("id")

        if os_id not in self.SUPPORTED_PLATFORMS:
            raise RuntimeError(f"Unsupported target platform '{os_id}'. Frooky only supports: {', '.join(self.SUPPORTED_PLATFORMS)}.")

        return os_id

    def _load_user_scripts(self) -> None:
        """Load user-provided scripts (-l/--load) before the frooky agent runs."""
        for script_path in self.options.user_scripts:
            source = Path(script_path).read_text(encoding="utf-8")
            script = self.session.create_script(source)
            script.load()
            self.user_scripts.append(script)

    def _attach_or_spawn(self) -> frida.core.Session:
        """Attach to or spawn the target process."""
        opts = self.options

        if opts.attach_frontmost:
            app = self.device.get_frontmost_application()
            if app is None:
                raise RuntimeError("No frontmost application found")
            return self.device.attach(app.pid)

        elif opts.attach_name:
            return self.device.attach(opts.attach_name)

        elif opts.attach_identifier:
            for proc in self.device.enumerate_processes():
                if proc.identifier == opts.attach_identifier:
                    return self.device.attach(proc.pid)
            return self.device.attach(opts.attach_identifier)

        elif opts.attach_pid:
            return self.device.attach(opts.attach_pid)

        elif opts.spawn:
            pid = self.device.spawn(opts.spawn)
            session = self.device.attach(pid)
            self.spawned_pid = pid
            return session

        else:
            raise RuntimeError("No target specified")

    def run(self) -> int:
        """Run the Frooky hooks."""
        try:
            with open(self.options.output_path, "w", encoding="utf-8") as f:
                pass  # Truncate file

            self.device = self._get_device()
            self.platform = self._detect_platform()

            self.session = self._attach_or_spawn()

            script_path = files("frooky") / "agent" / "dist" / f"agent-{self.platform}.js"
            script_source = script_path.read_text(encoding="utf-8")

            self._print_header()

            # Load any user-provided scripts before the frooky agent
            self._load_user_scripts()

            self.script = self.session.create_script(script_source)
            self.script.on("message", self._create_message_handler())
            self.script.load()

            if self.options.agent_option_verbose:
                log_level = "info"
            elif self.options.agent_option_very_verbose:
                log_level = "debug"
            else:
                log_level = "warn"
            self.script.exports_sync.init_frooky_agent(log_level, "console", self.options.agent_option_resolver_timeout)

            targets = self._prepare_targets()
            self.script.exports_sync.load_frooky_configs(targets)

            if self.options.spawn:
                self.device.resume(self.spawned_pid)

            while True:
                time.sleep(0.5)

        except KeyboardInterrupt:
            print("\b\b  ", end="", flush=True)
            print("\n\n  Stopping ...\n")

        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1

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

        return 0
