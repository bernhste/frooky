from __future__ import annotations

import argparse
import sys
from importlib.resources import files
from pathlib import Path

from . import __version__
from .frida_runner import FrookyRunner, RunnerOptions


def _add_common_args(parser: argparse.ArgumentParser) -> None:
    # Device selection group
    device_group = parser.add_argument_group("device selection")
    device_group.add_argument("-D", "--device", metavar="ID", help="Connect to device with the given ID")
    device_group.add_argument("-U", "--usb", action="store_true", help="Connect to USB device")
    device_group.add_argument("-R", "--remote", action="store_true", help="Connect to remote frida-server")
    device_group.add_argument("-H", "--host", metavar="HOST", help="Connect to remote frida-server on HOST")
    device_group.add_argument("--certificate", metavar="CERTIFICATE", help="Certificate used for secure communication with frida-server")

    # frooky agent options group
    agent_options = parser.add_argument_group("frooky agent options")
    agent_options.add_argument("-v", action="store_true", help="shows up to info logs from the frooky agent.")
    agent_options.add_argument("-vv", action="store_true", help="shows all logs including debug logs from the frooky agent.")
    agent_options.add_argument("-t", "--resolver-timeout", metavar="SECONDS", type=int, default=5, help="Timeout in seconds for module/class lookup (default: 5)")

    # Script loading options
    script_options = parser.add_argument_group("script options")
    script_options.add_argument(
        "-l",
        "--load",
        metavar="SCRIPT",
        dest="user_scripts",
        action="append",
        default=[],
        help="Load SCRIPT before the frooky agent is run (can be specified multiple times)",
    )

    # Target selection group (mutually exclusive)
    target_group = parser.add_mutually_exclusive_group(required=True)
    target_group.add_argument("-F", "--attach-frontmost", action="store_true", help="Attach to frontmost application")
    target_group.add_argument("-n", "--attach-name", metavar="NAME", help="Attach to NAME")
    target_group.add_argument("-N", "--attach-identifier", metavar="IDENTIFIER", help="Attach to IDENTIFIER")
    target_group.add_argument("-p", "--attach-pid", metavar="PID", type=int, help="Attach to PID")
    target_group.add_argument("-f", "--file", dest="spawn", metavar="TARGET", help="spawn TARGET")

    parser.add_argument("hooks", nargs="+", help="Path(s) to your input hook YAML file(s)")
    parser.add_argument("-o", "--output", metavar="PATH", default="output.json", help="File PATH for the frooky event log ndjson (default: output.json)")
    parser.add_argument("-e", "--print-events", action="store_true", default=False, help="Print the captured events to the terminal")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="frooky", description="Run Frooky hooks using Frida's Python bindings.")

    parser.suggest_on_error = True

    parser.add_argument(
        "--version",
        action="version",
        version=f"frooky {__version__}",
    )

    _add_common_args(parser)

    return parser


def main() -> int:
    parser = build_parser()
    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(1)

    args = parser.parse_args()

    if args.resolver_timeout <= 0:
        raise argparse.ArgumentTypeError(f"--resolver-timeout ({args.resolver_timeout}) is not a positive integer")

    # Validate that the android and ios agents are compiled and accessible
    agent_dist_path = files("frooky") / "agent" / "dist"
    required_files = [agent_dist_path / "version.json", agent_dist_path / "agent-android.js", agent_dist_path / "agent-ios.js"]

    if not all(file.exists() for file in required_files):
        print(
            f"Frooky agent not found in: {agent_dist_path}\nIf you don't use the distributed version, make sure to manually compile the agents first.\n",
            file=sys.stderr,
        )
        sys.exit(1)

    # Validate device selection
    device_count = sum([args.usb, args.device is not None, args.remote, args.host is not None])
    if device_count > 1:
        parser.error("Use only one of -D/--device, -U/--usb, -R/--remote, or -H/--host.")

    hook_paths = []
    for hook in args.hooks:
        hook_path = Path(hook)
        if not hook_path.exists():
            parser.error(f"Hooks file not found: {hook_path}")
        hook_paths.append(hook_path.resolve())

    script_paths = []
    for script in args.user_scripts:
        script_path = Path(script)
        if not script_path.exists():
            parser.error(f"Script file not found: {script_path}")
        script_paths.append(script_path.resolve())

    options = RunnerOptions(
        hook_paths=hook_paths,
        output_path=Path(args.output),
        device_id=args.device,
        use_usb=args.usb,
        remote=args.remote,
        host=args.host,
        certificate=args.certificate,
        attach_frontmost=args.attach_frontmost,
        attach_name=args.attach_name,
        attach_identifier=args.attach_identifier,
        attach_pid=args.attach_pid,
        spawn=args.spawn,
        user_scripts=script_paths,
        agent_option_verbose=args.v,
        agent_option_very_verbose=args.vv,
        agent_option_resolver_timeout=args.resolver_timeout,
        print_events=args.print_events,
    )

    runner = FrookyRunner(options)
    return runner.run()


if __name__ == "__main__":
    raise SystemExit(main())
