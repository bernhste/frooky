#!/usr/bin/env python3
"""List the attached Android devices with their Android version, API level, ABI and model.

Usage: uv run scripts/list_android_devices.py

Lists every device that `adb devices` lists (honoring ADB_SERVER_SOCKET), including offline
or unauthorized ones, whose properties can't be read.
"""

from __future__ import annotations

import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

ADB_TIMEOUT = 30  # seconds
PROPS = ("ro.build.version.release", "ro.build.version.sdk", "ro.product.cpu.abi", "ro.product.model")


def attached_devices() -> list[tuple[str, str]]:
    """Returns (serial, state) pairs, e.g. `("emulator-5554", "device")`."""
    lines = subprocess.run(["adb", "devices"], capture_output=True, text=True, timeout=ADB_TIMEOUT).stdout.splitlines()[1:]
    return [(parts[0], parts[1]) for parts in (line.split() for line in lines) if len(parts) == 2]


def device_row(serial: str, state: str) -> list[str]:
    if state != "device":
        return [serial, state, "", "", "", ""]
    # one shell call per device; getprop prints an empty line for a missing property
    cmd = "; ".join(f"getprop {prop}" for prop in PROPS)
    try:
        output = subprocess.run(["adb", "-s", serial, "shell", cmd], capture_output=True, text=True, timeout=ADB_TIMEOUT).stdout
    except subprocess.TimeoutExpired:
        return [serial, "timeout", "", "", "", ""]
    values = (output.replace("\r", "").split("\n") + [""] * len(PROPS))[: len(PROPS)]
    return [serial, state, *values]


def main() -> None:
    devices = attached_devices()
    if not devices:
        sys.exit("No Android device attached (adb devices)")
    with ThreadPoolExecutor() as pool:
        rows = list(pool.map(lambda device: device_row(*device), devices))
    rows.sort(key=lambda row: (not row[3].isdigit(), int(row[3]) if row[3].isdigit() else 0, row[0]))

    header = ["SERIAL", "STATE", "ANDROID", "API", "ABI", "MODEL"]
    widths = [max(len(row[i]) for row in [header, *rows]) for i in range(len(header))]
    for row in [header, *rows]:
        print("  ".join(value.ljust(width) for value, width in zip(row, widths)).rstrip())


if __name__ == "__main__":
    main()
