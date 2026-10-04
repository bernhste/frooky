#!/usr/bin/env python3
"""Run the Android integration tests (tests/integration/android) on one or every attached device.

The device is chosen like adb does: -s <serial>, else $ANDROID_SERIAL, else the only attached
device. With -a, the tests run once per attached device and fail if any run fails. Arguments
this script doesn't know go to pytest, e.g. `-k receive_int`, `-x` or test paths; without a
path, all of tests/integration/android runs.

Usage: uv run scripts/run_integration_tests.py [-s <serial> | -a] [--appium <ip>[:<port>]] [<pytest args> ...]
e.g.:  uv run scripts/run_integration_tests.py -s emulator-5554 tests/integration/android/test_frida_flags.py

Needs the target apps (`uv run scripts/sync_target_apps.py`), a running frida-server
(`uv run scripts/prepare_android_devices.py`) and Appium.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests" / "integration" / "android"
APPIUM_DEFAULT = "127.0.0.1"
APPIUM_DEFAULT_PORT = 4723
APPIUM_DEFAULT_URL = os.environ.get("APPIUM_URL", f"http://{APPIUM_DEFAULT}:{APPIUM_DEFAULT_PORT}").rstrip("/")
ADB_TIMEOUT = 30  # seconds


def attached_serials() -> list[str]:
    lines = subprocess.run(["adb", "devices"], capture_output=True, text=True, timeout=ADB_TIMEOUT).stdout.splitlines()[1:]
    return [parts[0] for parts in (line.split() for line in lines) if len(parts) == 2 and parts[1] == "device"]


def describe(serial: str) -> str:
    """e.g. `emulator-5554 (Android 15, API 35)`"""

    def prop(name: str) -> str:
        return subprocess.run(["adb", "-s", serial, "shell", "getprop", name], capture_output=True, text=True, timeout=ADB_TIMEOUT).stdout.strip()

    return f"{serial} (Android {prop('ro.build.version.release')}, API {prop('ro.build.version.sdk')})"


def appium_reachable(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/status", timeout=5) as response:
            return response.status == 200
    except OSError:
        return False


def run_pytest(serial: str, appium_url: str, pytest_args: list[str]) -> int:
    # read by tests/integration/conftest.py; DEVICE_UDID would override the device for Appium
    env = {**{k: v for k, v in os.environ.items() if k != "DEVICE_UDID"}, "ANDROID_SERIAL": serial, "APPIUM_URL": appium_url}
    # a test path like `tests/.../test_x.py` or `test_x.py::TestX::test_y` replaces the default
    has_path = any(not arg.startswith("-") and Path(arg.split("::")[0]).exists() for arg in pytest_args)
    return subprocess.run([sys.executable, "-m", "pytest", *([] if has_path else [str(TESTS)]), *pytest_args], env=env).returncode


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], epilog="Other arguments go to pytest.", allow_abbrev=False)
    devices = parser.add_mutually_exclusive_group()
    devices.add_argument("-s", "--serial", help="Device to test (default: $ANDROID_SERIAL, else the only attached one)")
    devices.add_argument("-a", "--all", action="store_true", help="Test on every attached device, one after another")
    parser.add_argument("--appium", metavar="IP[:PORT]", help=f"Appium server (default: $APPIUM_URL, else {APPIUM_DEFAULT}:{APPIUM_DEFAULT_PORT})")
    args, pytest_args = parser.parse_known_args()
    appium_url = f"http://{args.appium if ':' in args.appium else f'{args.appium}:{APPIUM_DEFAULT_PORT}'}" if args.appium else APPIUM_DEFAULT_URL

    # an unreachable Appium makes every test hang in connection timeouts and retries
    if not appium_reachable(appium_url):
        sys.exit(f"Appium not reachable at {appium_url}/status (--appium <ip>[:<port>])")

    attached = attached_serials()
    if args.all:
        serials = attached
    elif serial := args.serial or os.environ.get("ANDROID_SERIAL"):
        serials = [serial]
    elif len(attached) > 1:
        sys.exit("Several devices attached, pass -s <serial> (or set ANDROID_SERIAL) for one of them, or -a for all:\n" + "\n".join(f"  {s}" for s in attached))
    else:
        serials = attached
    if not serials:
        sys.exit("No Android device attached (adb devices)")

    if len(serials) == 1:
        sys.exit(run_pytest(serials[0], appium_url, pytest_args))

    results = {}
    for serial in serials:
        title = describe(serial)
        print(f"===== {title} =====", flush=True)
        results[title] = run_pytest(serial, appium_url, pytest_args)
    print("===== Summary =====")
    for title, code in results.items():
        print(f"{'passed' if code == 0 else 'FAILED'}  {title}")
    sys.exit(0 if all(code == 0 for code in results.values()) else 1)


if __name__ == "__main__":
    main()
