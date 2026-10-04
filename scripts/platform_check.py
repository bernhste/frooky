#!/usr/bin/env python3
"""Check frooky on a new platform: a host OS, an Android version or a device.

Records the host and the devices, runs the host unit tests once, then the agent tests and
the Android integration tests on each device, and writes a report that can be attached to an
issue or PR.

Usage: uv run scripts/platform_check.py [-s <serial> ...] [--skip unit,agent,integration] [-k <pattern>] [--out <dir>]
       [--adb-host <ip>[:<port>]] [--appium <ip>[:<port>]]

Without -s, checks every device that `adb devices` lists, one after another, reaching them
through adb (a remote adb server with --adb-host, default port 5037). Expects a running
frida-server (`uv run scripts/prepare_android_devices.py`). The integration tests also need
Appium (--appium, default $APPIUM_URL, else 127.0.0.1:4723) and the target apps
(`uv run scripts/sync_target_apps.py`); without them, they are skipped and the report says why.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AGENT_DIR = ROOT / "frooky" / "agent"
TARGET_APPS_DIR = ROOT / "tests" / "target-apps" / "android"
SUMMARIZE = ROOT / ".github" / "scripts" / "summarize-test-results.py"
ADB_DEFAULT_PORT = 5037
APPIUM_DEFAULT = "127.0.0.1"
APPIUM_DEFAULT_PORT = 4723
APPIUM_DEFAULT_URL = os.environ.get("APPIUM_URL", f"http://{APPIUM_DEFAULT}:{APPIUM_DEFAULT_PORT}").rstrip("/")
STEPS = ("unit", "agent", "integration")
DEVICE_TIMEOUT = 10  # seconds
GOOGLE_DIALER = "com.google.android.dialer"
AOSP_DIALER = "com.android.dialer"


@dataclass
class StepResult:
    name: str
    status: str  # passed, failed, skipped
    duration: float = 0.0  # seconds
    note: str = ""
    summary: str = ""  # Markdown from summarize-test-results.py


@dataclass
class DeviceCheck:
    serial: str
    info: dict[str, str]
    error: str
    results: list[StepResult]

    @property
    def title(self) -> str:
        """e.g. `emulator-5554 (Android 15, API 35)`"""
        return f"{self.serial} ({self.info['OS']}, API {self.info['API level']})" if self.info else self.serial


def run(cmd: list[str], log: Path, cwd: Path = ROOT, env: dict[str, str] | None = None) -> int:
    """Runs cmd, shows its output and appends it to log."""
    print(f"\n$ {' '.join(cmd)}", flush=True)
    with log.open("a", encoding="utf-8") as handle:
        handle.write(f"\n$ {' '.join(cmd)}\n")
        process = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        assert process.stdout is not None
        for line in process.stdout:
            sys.stdout.write(line)
            handle.write(line)
        return process.wait()


def output_of(cmd: list[str], cwd: Path = ROOT) -> str:
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "not found"


def summarize(kind: str, report: Path, title: str) -> str:
    if not report.exists():
        return ""
    env = {k: v for k, v in os.environ.items() if k != "GITHUB_STEP_SUMMARY"}
    return subprocess.run([sys.executable, str(SUMMARIZE), kind, str(report), title], capture_output=True, text=True, env=env).stdout


def host_info() -> dict[str, str]:
    import frida

    return {
        "OS": f"{platform.system()} {platform.release()}",
        "OS version": platform.mac_ver()[0] or platform.version(),
        "Machine": platform.machine(),
        "Python": platform.python_version(),
        "Node": output_of(["node", "--version"]),
        "frida (Python)": frida.__version__,
        "frooky commit": output_of(["git", "--no-pager", "rev-parse", "--short", "HEAD"]) + (" (dirty)" if output_of(["git", "--no-pager", "status", "--porcelain"]) else ""),
    }


def device_info(serial: str) -> tuple[dict[str, str], set[str], str]:
    """The device's properties and installed app ids, or an error message."""
    import frida

    try:
        device = frida.get_device(serial, timeout=DEVICE_TIMEOUT)
        params = device.query_system_parameters()
        apps = {app.identifier for app in device.enumerate_applications()}
    except Exception as e:  # frida raises several unrelated types here
        return {}, set(), f"{type(e).__name__}: {e}"
    os_info = params.get("os", {})
    info = {
        "Device": f"{device.name} ({serial})",
        "OS": f"{os_info.get('name', os_info.get('id', '?'))} {os_info.get('version', '')}".strip(),
        "API level": str(params.get("api-level", "?")),
        "Arch": str(params.get("arch", "?")),
        "Access": str(params.get("access", "?")),
    }
    return info, apps, ""


def version_label(info: dict[str, str]) -> str:
    """Android version and API level for file names, e.g. `A15_35`; empty if the device wasn't reachable."""
    return f"A{info['OS'].removeprefix('Android').strip()}_{info['API level']}" if info else ""


def attached_serials() -> list[str]:
    lines = output_of(["adb", "devices"]).splitlines()[1:]
    return [parts[0] for parts in (line.split() for line in lines) if len(parts) == 2 and parts[1] == "device"]


def with_port(address: str, default_port: int) -> str:
    """Appends default_port to an address without one, e.g. `192.168.1.189` -> `192.168.1.189:5037`."""
    return address if ":" in address else f"{address}:{default_port}"


def appium_reachable(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/status", timeout=5) as response:
            return response.status == 200
    except OSError:
        return False


def step(name: str, cmd: list[str], log: Path, cwd: Path = ROOT, report: tuple[str, Path, str] | None = None, env: dict[str, str] | None = None) -> StepResult:
    start = time.monotonic()
    code = run(cmd, log, cwd, env)
    result = StepResult(name, "passed" if code == 0 else "failed", time.monotonic() - start)
    if code != 0:
        result.note = f"exit code {code}, see {log.name}"
    if report:
        result.summary = summarize(*report)
    return result


def table(rows: dict[str, str]) -> str:
    lines = ["| | |", "| --- | --- |"]
    lines += [f"| {key} | {value} |" for key, value in rows.items()]
    return "\n".join(lines)


def check_device(serial: str, device: tuple[dict[str, str], set[str], str], appium_url: str, out: Path, skip: set[str], pattern: str | None) -> DeviceCheck:
    """Runs the agent and integration tests on one device; logs to out/platform-check-<serial>_<label>.log, results to out/<serial>_<label>/."""
    info, apps, error = device
    name = "_".join(filter(None, [serial, version_label(info)]))
    print(f"\n{'=' * 20} {name} {'=' * 20}", flush=True)
    log = out / f"platform-check-{name}.log"
    out = out / name
    out.mkdir(parents=True, exist_ok=True)
    print("Device:", json.dumps(info, indent=2) if info else error)
    # the tests' device selection (tests/integration/conftest.py); DEVICE_UDID would override it for Appium
    env = {**{k: v for k, v in os.environ.items() if k != "DEVICE_UDID"}, "ANDROID_SERIAL": serial, "APPIUM_URL": appium_url}
    results: list[StepResult] = []

    if "agent" in skip:
        results.append(StepResult("agent", "skipped", note="--skip"))
    elif error:
        results.append(StepResult("agent", "failed", note="device not reachable"))
    elif shutil.which("npm") is None:
        results.append(StepResult("agent", "failed", note="npm not found"))
    else:
        report = out / "test-results-agent.json"
        result = step("agent", ["npm", "run", "test:android", "--", "-o", str(report)], log, cwd=AGENT_DIR, report=("frida-test", report, f"Agent tests ({serial})"), env=env)
        # test-android.sh falls back to the AOSP dialer on its own
        if "FRIDA_TEST_APP" not in env and GOOGLE_DIALER not in apps and AOSP_DIALER in apps:
            result.note = " ".join(filter(None, [result.note, f"in {AOSP_DIALER} (no Google dialer)"]))
        results.append(result)

    if "integration" in skip:
        results.append(StepResult("integration", "skipped", note="--skip"))
    elif error:
        results.append(StepResult("integration", "failed", note="device not reachable"))
    else:
        expected = {f"{d.name.replace('-', '_')}.frooky.target.app" for d in TARGET_APPS_DIR.iterdir() if d.is_dir() and d.name != "dist" and not d.name.startswith(".")}
        missing = sorted(expected - apps)
        if missing:
            results.append(StepResult("integration", "skipped", note=f"target apps not installed: {', '.join(missing)} (`uv run scripts/sync_target_apps.py -s {serial}`)"))
        elif not appium_reachable(appium_url):
            results.append(StepResult("integration", "skipped", note=f"Appium not reachable at {appium_url}"))
        else:
            report = out / "test-results-integration.jsonl"
            cmd = ["uv", "run", "pytest", "tests/integration/android", f"--report-log={report}"]
            if pattern:
                cmd += ["-k", pattern]
            results.append(step("integration", cmd, log, report=("pytest", report, f"Integration tests ({serial})"), env=env))

    return DeviceCheck(serial, info, error, results)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-s", "--serial", action="append", help="Device to check (repeatable); default: all attached")
    parser.add_argument("--skip", default="", help=f"comma-separated steps to skip: {', '.join(STEPS)}")
    parser.add_argument("-k", dest="pattern", help="only run the integration tests matching this pytest -k pattern")
    parser.add_argument("--out", type=Path, help="report directory (default: .platform-check/<timestamp>)")
    parser.add_argument("--adb-host", metavar="IP[:PORT]", help=f"use the adb server on this host (default port: {ADB_DEFAULT_PORT}; default: $ADB_SERVER_SOCKET or the local one)")
    parser.add_argument("--appium", metavar="IP[:PORT]", help=f"Appium server (default: $APPIUM_URL, else {APPIUM_DEFAULT}:{APPIUM_DEFAULT_PORT})")
    args = parser.parse_args()
    appium_url = f"http://{with_port(args.appium, APPIUM_DEFAULT_PORT)}" if args.appium else APPIUM_DEFAULT_URL
    if args.adb_host:
        # adb, frida and every step's subprocess read it; set before frida first enumerates devices
        os.environ["ADB_SERVER_SOCKET"] = f"tcp:{with_port(args.adb_host, ADB_DEFAULT_PORT)}"

    skip = {s.strip() for s in args.skip.split(",") if s.strip()}
    if unknown := skip - set(STEPS):
        parser.error(f"unknown step(s): {', '.join(sorted(unknown))}")
    serials = args.serial or attached_serials()
    checks_devices = not {"agent", "integration"} <= skip
    if not serials and checks_devices:
        parser.error("no Android device attached (adb devices); skip agent and integration to check only the host")

    targets = {serial: device_info(serial) for serial in serials} if checks_devices else {}
    labels = list(dict.fromkeys(filter(None, (version_label(info) for info, _, _ in targets.values()))))
    out = (args.out or ROOT / ".platform-check" / "_".join([datetime.now().strftime("%Y%m%d-%H%M%S"), *labels])).resolve()
    out.mkdir(parents=True, exist_ok=True)
    log = out / "platform-check.log"

    host = host_info()
    print("Host:", json.dumps(host, indent=2))

    results: list[StepResult] = []
    devices: list[DeviceCheck] = []

    build = step("build", ["uv", "run", "compile-agent", "--dev"], log)
    results.append(build)
    if build.status == "passed":
        if "unit" in skip:
            results.append(StepResult("unit", "skipped", note="--skip"))
        else:
            report = out / "test-results-unit.jsonl"
            results.append(step("unit", ["uv", "run", "pytest", "tests/unit", f"--report-log={report}"], log, report=("pytest", report, "Host unit tests")))
        devices = [check_device(serial, device, appium_url, out, skip, args.pattern) for serial, device in targets.items()]

    environment = {"host": host, "adbServer": os.environ.get("ADB_SERVER_SOCKET", "local"), "appium": appium_url, "devices": [{"serial": d.serial, "device": d.info, "deviceError": d.error} for d in devices]}
    (out / "environment.json").write_text(json.dumps(environment, indent=2), encoding="utf-8")
    return finish(out, host, results, devices)


ICONS = {"passed": "✅", "failed": "❌", "skipped": "⏭️"}


def steps_table(results: list[StepResult]) -> str:
    return "| Step | Result | Duration | Note |\n| --- | --- | --- | --- |" + "".join(f"\n| {r.name} | {ICONS[r.status]} {r.status} | {r.duration:.0f} s | {r.note} |" for r in results)


def finish(out: Path, host: dict[str, str], results: list[StepResult], devices: list[DeviceCheck]) -> int:
    parts = [
        "# frooky platform check",
        f"{datetime.now().isoformat(timespec='seconds')}",
        "## Host",
        table(host),
        steps_table(results),
    ]
    parts += [r.summary for r in results if r.summary]
    for d in devices:
        parts += [f"## Device {d.title}", table(d.info) if d.info else f"Not reachable: `{d.error}`", steps_table(d.results)]
        parts += [r.summary for r in d.results if r.summary]
    report = out / "report.md"
    report.write_text("\n\n".join(parts) + "\n", encoding="utf-8")

    print(f"\n{'=' * 60}")
    for r in results:
        print(f"{ICONS[r.status]} {'host':<38} {r.name:<12} {r.status:<8} {r.note}")
    for d in devices:
        for r in d.results:
            print(f"{ICONS[r.status]} {d.title:<38} {r.name:<12} {r.status:<8} {r.note}")
    print(f"\nReport: {report}")
    all_results = results + [r for d in devices for r in d.results]
    return 1 if any(r.status == "failed" for r in all_results) else 0


if __name__ == "__main__":
    sys.exit(main())
