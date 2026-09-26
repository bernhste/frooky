from __future__ import annotations

import argparse
import sys
from importlib.resources import files
from pathlib import Path

from . import __version__
from .runner import FrookyRunner, RunnerOptions


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
    parser.add_argument(
        "-w",
        "--watch",
        action="store_true",
        default=False,
        help="Watch the hook files and apply changes while running. Only new or changed hooks are re-hooked. Press R to also retry hooks that failed to resolve.",
    )


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


def _validate_agent_dist() -> None:
    """Make sure the compiled Frida agent is present before we try to inject it."""
    agent_dist_path = files("frooky") / "agent" / "dist"
    required_files = [agent_dist_path / "version.json", agent_dist_path / "agent-android.js"]

    if not all(file.exists() for file in required_files):
        print(
            f"Frooky agent not found in: {agent_dist_path}\nIf you don't use the distributed version, make sure to manually compile the agents first.\n",
            file=sys.stderr,
        )
        sys.exit(1)


def _validate_device_selection(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    device_count = sum([args.usb, args.device is not None, args.remote, args.host is not None])
    if device_count > 1:
        parser.error("Use only one of -D/--device, -U/--usb, -R/--remote, or -H/--host.")


def _resolve_paths(parser: argparse.ArgumentParser, paths: list[str], not_found_label: str) -> list[Path]:
    resolved = []
    for raw_path in paths:
        path = Path(raw_path)
        if not path.exists():
            parser.error(f"{not_found_label} not found: {path}")
        resolved.append(path.resolve())
    return resolved


def _build_runner_options(args: argparse.Namespace, hook_paths: list[Path], script_paths: list[Path]) -> RunnerOptions:
    return RunnerOptions(
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
        watch=args.watch,
    )


def main() -> int:
    parser = build_parser()
    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(1)

    args = parser.parse_args()

    if args.resolver_timeout <= 0:
        raise argparse.ArgumentTypeError(f"--resolver-timeout ({args.resolver_timeout}) is not a positive integer")

    _validate_agent_dist()
    _validate_device_selection(parser, args)

    hook_paths = _resolve_paths(parser, args.hooks, "Hooks file")
    script_paths = _resolve_paths(parser, args.user_scripts, "Script file")

    options = _build_runner_options(args, hook_paths, script_paths)

    runner = FrookyRunner(options)
    return runner.run()


if __name__ == "__main__":
    raise SystemExit(main())
