#!/usr/bin/env python3
"""Check frooky on a new platform: a host OS, an Android version or a device.

Records the host and device, then runs the host unit tests, the agent tests and the
Android integration tests against the device that `frida -U` uses, and writes a report
that can be attached to an issue or PR.

Usage: uv run scripts/platform_check.py [--skip unit,agent,integration] [-k <pattern>] [--out <dir>]

Expects a running frida-server matching `frida --version`. The integration tests also
need Appium (APPIUM_URL) and the target apps from tests/target-apps/android; without
them, they are skipped and the report says why.
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
APPIUM_URL = os.environ.get("APPIUM_URL", "http://127.0.0.1:4723")
STEPS = ("unit", "agent", "integration")
DEVICE_TIMEOUT = 10  # seconds


@dataclass
class StepResult:
    name: str
    status: str  # passed, failed, skipped
    duration: float = 0.0  # seconds
    note: str = ""
    summary: str = ""  # Markdown from summarize-test-results.py


def run(cmd: list[str], log: Path, cwd: Path = ROOT) -> int:
    """Runs cmd, shows its output and appends it to log."""
    print(f"\n$ {' '.join(cmd)}", flush=True)
    with log.open("a", encoding="utf-8") as handle:
        handle.write(f"\n$ {' '.join(cmd)}\n")
        process = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
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


def device_info() -> tuple[dict[str, str], set[str], str]:
    """The device's properties and installed app ids, or an error message."""
    import frida

    try:
        device = frida.get_usb_device(timeout=DEVICE_TIMEOUT)
        params = device.query_system_parameters()
        apps = {app.identifier for app in device.enumerate_applications()}
    except Exception as e:  # frida raises several unrelated types here
        return {}, set(), f"{type(e).__name__}: {e}"
    os_info = params.get("os", {})
    info = {
        "Device": device.name,
        "OS": f"{os_info.get('name', os_info.get('id', '?'))} {os_info.get('version', '')}".strip(),
        "API level": str(params.get("api-level", "?")),
        "Arch": str(params.get("arch", "?")),
        "Access": str(params.get("access", "?")),
    }
    return info, apps, ""


def appium_reachable() -> bool:
    try:
        with urllib.request.urlopen(f"{APPIUM_URL}/status", timeout=5) as response:
            return response.status == 200
    except OSError:
        return False


def step(name: str, cmd: list[str], log: Path, cwd: Path = ROOT, report: tuple[str, Path, str] | None = None) -> StepResult:
    start = time.monotonic()
    code = run(cmd, log, cwd)
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--skip", default="", help=f"comma-separated steps to skip: {', '.join(STEPS)}")
    parser.add_argument("-k", dest="pattern", help="only run the integration tests matching this pytest -k pattern")
    parser.add_argument("--out", type=Path, help="report directory (default: .platform-check/<timestamp>)")
    args = parser.parse_args()

    skip = {s.strip() for s in args.skip.split(",") if s.strip()}
    if unknown := skip - set(STEPS):
        parser.error(f"unknown step(s): {', '.join(sorted(unknown))}")

    out = (args.out or ROOT / ".platform-check" / datetime.now().strftime("%Y%m%d-%H%M%S")).resolve()
    out.mkdir(parents=True, exist_ok=True)
    log = out / "platform-check.log"

    host = host_info()
    device, apps, device_error = device_info()
    print("Host:", json.dumps(host, indent=2))
    print("Device:", json.dumps(device, indent=2) if device else device_error)
    (out / "environment.json").write_text(json.dumps({"host": host, "device": device, "deviceError": device_error}, indent=2), encoding="utf-8")

    results: list[StepResult] = []

    build = step("build", ["uv", "run", "compile-agent", "--dev"], log)
    results.append(build)
    if build.status == "failed":
        return finish(out, host, device, device_error, results)

    if "unit" in skip:
        results.append(StepResult("unit", "skipped", note="--skip"))
    else:
        report = out / "test-results-unit.jsonl"
        results.append(step("unit", ["uv", "run", "pytest", "tests/unit", f"--report-log={report}"], log, report=("pytest", report, "Host unit tests")))

    if "agent" in skip:
        results.append(StepResult("agent", "skipped", note="--skip"))
    elif device_error:
        results.append(StepResult("agent", "failed", note="no device"))
    elif shutil.which("npm") is None:
        results.append(StepResult("agent", "failed", note="npm not found"))
    else:
        report = out / "test-results-agent.json"
        results.append(step("agent", ["npm", "run", "test:android", "--", "-o", str(report)], log, cwd=AGENT_DIR, report=("frida-test", report, "Agent tests")))

    if "integration" in skip:
        results.append(StepResult("integration", "skipped", note="--skip"))
    elif device_error:
        results.append(StepResult("integration", "failed", note="no device"))
    else:
        expected = {f"{d.name.replace('-', '_')}.frooky.target.app" for d in TARGET_APPS_DIR.iterdir() if d.is_dir() and d.name != "dist" and not d.name.startswith(".")}
        missing = sorted(expected - apps)
        if missing:
            results.append(StepResult("integration", "skipped", note=f"target apps not installed: {', '.join(missing)} (`make install-all` in tests/target-apps/android)"))
        elif not appium_reachable():
            results.append(StepResult("integration", "skipped", note=f"Appium not reachable at {APPIUM_URL}"))
        else:
            report = out / "test-results-integration.jsonl"
            cmd = ["uv", "run", "pytest", "tests/integration/android", f"--report-log={report}"]
            if args.pattern:
                cmd += ["-k", args.pattern]
            results.append(step("integration", cmd, log, report=("pytest", report, "Integration tests (Android)")))

    return finish(out, host, device, device_error, results)


def finish(out: Path, host: dict[str, str], device: dict[str, str], device_error: str, results: list[StepResult]) -> int:
    icons = {"passed": "✅", "failed": "❌", "skipped": "⏭️"}
    parts = [
        "# frooky platform check",
        f"{datetime.now().isoformat(timespec='seconds')}",
        "## Host",
        table(host),
        "## Device",
        table(device) if device else f"Not reachable: `{device_error}`",
        "## Steps",
        "| Step | Result | Duration | Note |\n| --- | --- | --- | --- |",
    ]
    parts[-1] += "".join(f"\n| {r.name} | {icons[r.status]} {r.status} | {r.duration:.0f} s | {r.note} |" for r in results)
    parts += [r.summary for r in results if r.summary]
    report = out / "report.md"
    report.write_text("\n\n".join(parts) + "\n", encoding="utf-8")

    print(f"\n{'=' * 60}")
    for r in results:
        print(f"{icons[r.status]} {r.name:<12} {r.status:<8} {r.note}")
    print(f"\nReport: {report}")
    return 1 if any(r.status == "failed" for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
