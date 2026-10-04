#!/usr/bin/env python3
"""Build the Android target apps and make sure every attached device has the latest build installed.

Builds each app with the Makefile in tests/target-apps/android (incremental unless -c), then
compares the SHA-256 of the installed base.apk with dist/<app>.apk on each device. An app that
is missing or differs is uninstalled, so nothing of the old build remains, and installed again.

Usage: uv run scripts/sync_target_apps.py [<app> ...] [-s <serial> ...] [-c]

Without apps, syncs all apps in tests/target-apps/android; without -s, all attached devices.
Use -c after changing an app's build.gradle.kts.* or AndroidManifest.xml or removing a source
file: an incremental build only copies sources over the previous build.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET_APPS_DIR = ROOT / "tests" / "target-apps" / "android"
DIST_DIR = TARGET_APPS_DIR / "dist"
ADB_TIMEOUT = 30  # seconds
INSTALL_TIMEOUT = 300  # seconds


def all_apps() -> list[str]:
    return sorted(path.name for path in TARGET_APPS_DIR.iterdir() if path.is_dir() and path.name != "dist" and not path.name.startswith("."))


def package_id(app: str) -> str:
    return f"{app.replace('-', '_')}.frooky.target.app"


def make(target: str, app: str, serial: str | None = None, capture: bool = False) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "ANDROID_SERIAL": serial} if serial else None
    return subprocess.run(["make", target, f"TARGET_APP={app}"], cwd=TARGET_APPS_DIR, env=env, capture_output=capture, text=True, timeout=None if target == "build" else INSTALL_TIMEOUT)


def build(app: str, clean: bool) -> str:
    """Builds app and returns the SHA-256 of its APK."""
    print(f"===== Building {app}{' (clean)' if clean else ''} =====", flush=True)
    if clean and make("clean", app).returncode != 0:
        sys.exit(f"make clean TARGET_APP={app} failed")
    if make("build", app).returncode != 0:
        sys.exit(f"make build TARGET_APP={app} failed")
    return hashlib.sha256((DIST_DIR / f"{app}.apk").read_bytes()).hexdigest()


def installed_hash(serial: str, app: str) -> str | None:
    """Returns the SHA-256 of the app's base.apk on the device, or None if it isn't installed."""
    paths = subprocess.run(["adb", "-s", serial, "shell", "pm", "path", package_id(app)], capture_output=True, text=True, timeout=ADB_TIMEOUT).stdout.split()
    base = next((p.removeprefix("package:") for p in paths if p.endswith("/base.apk")), None)
    if base is None:
        return None
    output = subprocess.run(["adb", "-s", serial, "shell", "sha256sum", base], capture_output=True, text=True, timeout=ADB_TIMEOUT).stdout
    return output.split()[0] if output else ""


def sync(serial: str, app: str, apk_hash: str) -> bool:
    current = installed_hash(serial, app)
    if current == apk_hash:
        print(f"  ok    {app} up to date", flush=True)
        return True
    if current is not None:
        make("uninstall", app, serial, capture=True)
    result = make("install", app, serial, capture=True)
    if result.returncode != 0 or installed_hash(serial, app) != apk_hash:
        print(f"  FAIL  {app}: install failed\n{(result.stdout + result.stderr).strip()}", flush=True)
        return False
    print(f"  ok    {app} {'updated' if current is not None else 'installed'}", flush=True)
    return True


def attached_serials() -> list[str]:
    lines = subprocess.run(["adb", "devices"], capture_output=True, text=True, timeout=ADB_TIMEOUT).stdout.splitlines()[1:]
    return [parts[0] for parts in (line.split() for line in lines) if len(parts) == 2 and parts[1] == "device"]


def main() -> None:
    apps = all_apps()
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("apps", nargs="*", metavar="app", help=f"Apps to sync (default: all, {', '.join(apps)})")
    parser.add_argument("-s", "--serial", action="append", help="Device to sync (repeatable); default: all attached")
    parser.add_argument("-c", "--clean", action="store_true", help="Remove the previous build before building")
    args = parser.parse_args()

    unknown = [app for app in args.apps if app not in apps]
    if unknown:
        sys.exit(f"Unknown target app: {', '.join(unknown)} (available: {', '.join(apps)})")
    serials = args.serial or attached_serials()
    if not serials:
        sys.exit("No Android device attached (adb devices)")

    hashes = {app: build(app, args.clean) for app in args.apps or apps}

    results = {}
    for serial in serials:
        print(f"===== {serial} =====", flush=True)
        results[serial] = all([sync(serial, app, apk_hash) for app, apk_hash in hashes.items()])
    print("===== Summary =====")
    for serial, ok in results.items():
        print(f"{'ready ' if ok else 'FAILED'}  {serial}")
    sys.exit(0 if all(results.values()) else 1)


if __name__ == "__main__":
    main()
