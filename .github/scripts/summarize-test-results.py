#!/usr/bin/env python3
"""Render a test report as Markdown for $GITHUB_STEP_SUMMARY.

Usage: summarize-test-results.py {pytest|frida-test} <report> <title>

- pytest: JSONL written by `pytest --report-log=<report>`
- frida-test: JSON written by `frida-test -o <report>`
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

ICONS = {"passed": "✅", "failed": "❌", "error": "💥", "skipped": "⏭️", "xfailed": "⚠️", "xpassed": "⚠️"}
# Failure output beyond this is cut so the summary stays below GitHub's 1 MiB limit
MAX_ERROR_CHARS = 4000


@dataclass
class Test:
    group: str
    name: str
    outcome: str
    duration: float  # seconds
    message: str = ""


@dataclass
class Report:
    tests: list[Test] = field(default_factory=list)
    duration: float | None = None


def parse_pytest(path: Path) -> Report:
    report = Report()
    by_id: dict[str, Test] = {}
    start = stop = None

    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        kind = entry.get("$report_type")

        if kind == "CollectReport" and entry.get("outcome") == "failed":
            nodeid = entry.get("nodeid") or "collection"
            report.tests.append(Test(nodeid, "collection", "error", 0.0, longrepr_text(entry.get("longrepr"))))
            continue
        if kind != "TestReport":
            continue

        start = min(start, entry["start"]) if start is not None else entry.get("start")
        stop = max(stop, entry["stop"]) if stop is not None else entry.get("stop")

        nodeid = entry["nodeid"]
        when = entry["when"]
        outcome = entry["outcome"]
        test = by_id.get(nodeid)
        if test is None:
            group, _, name = nodeid.partition("::")
            test = Test(group, name or nodeid, "passed", 0.0)
            by_id[nodeid] = test
            report.tests.append(test)
        test.duration += entry.get("duration", 0.0)

        if "xfail" in entry.get("keywords", {}) or entry.get("wasxfail") is not None:
            if when == "call":
                test.outcome = "xfailed" if outcome == "skipped" else "xpassed"
            continue
        if outcome == "failed":
            # a failing setup/teardown is an error, a failing test body is a failure
            test.outcome = "failed" if when == "call" else "error"
            test.message = longrepr_text(entry.get("longrepr"))
        elif outcome == "skipped" and test.outcome == "passed":
            test.outcome = "skipped"
            test.message = longrepr_text(entry.get("longrepr"))

    if start is not None and stop is not None:
        report.duration = stop - start
    return report


def longrepr_text(longrepr: object) -> str:
    if longrepr is None:
        return ""
    if isinstance(longrepr, str):
        return longrepr
    # skips are serialized as [path, line, reason]
    if isinstance(longrepr, list) and len(longrepr) == 3:
        return str(longrepr[2]).removeprefix("Skipped: ")
    if isinstance(longrepr, dict):
        crash = (longrepr.get("reprcrash") or {}).get("message")
        entries = (longrepr.get("reprtraceback") or {}).get("reprentries") or []
        lines = (entries[-1].get("data") or {}).get("lines") if entries else None
        if lines:
            return "\n".join(lines)
        if crash:
            return crash
    return json.dumps(longrepr)


def parse_frida_test(path: Path) -> Report:
    data = json.loads(path.read_text(encoding="utf-8"))
    report = Report(duration=data.get("durationMs", 0) / 1000)

    def walk(group: str, result: dict, prefix: list[str]) -> None:
        children = result.get("children") or []
        names = [*prefix, result["name"]] if result.get("name") else prefix
        if not children:
            error = result.get("error") or {}
            report.tests.append(
                Test(
                    group,
                    " › ".join(names) or group,
                    result["status"],
                    result.get("durationMs", 0) / 1000,
                    error.get("stack") or error.get("message") or "",
                )
            )
            return
        for child in children:
            walk(group, child, names)

    for suite in data.get("testSuitesResults", []):
        result = suite.get("testResult")
        if result is None:
            report.tests.append(Test(suite["name"], suite["name"], suite["status"], 0.0))
            continue
        # the suite's root result is the file itself, so its name is not repeated per test
        if result.get("children"):
            for child in result["children"]:
                walk(suite["name"], child, [])
        else:
            walk(suite["name"], result, [])
    return report


def fmt_duration(seconds: float) -> str:
    if seconds < 1:
        return f"{seconds * 1000:.0f} ms"
    if seconds < 60:
        return f"{seconds:.2f} s"
    return f"{int(seconds // 60)} min {seconds % 60:.0f} s"


def code_block(text: str) -> str:
    if len(text) > MAX_ERROR_CHARS:
        text = text[:MAX_ERROR_CHARS] + "\n… (truncated, see the uploaded test results)"
    fence = "````" if "```" in text else "```"
    return f"{fence}text\n{text}\n{fence}"


def render(report: Report, title: str) -> str:
    counts: dict[str, int] = {}
    for test in report.tests:
        counts[test.outcome] = counts.get(test.outcome, 0) + 1
    problems = [t for t in report.tests if t.outcome in ("failed", "error")]
    status = "❌ Failed" if problems else "✅ Passed"

    out = [f"## {title}: {status}", ""]
    out += ["| Total | ✅ Passed | ❌ Failed | 💥 Errors | ⏭️ Skipped | ⏱️ Duration |", "| ---: | ---: | ---: | ---: | ---: | ---: |"]
    duration = report.duration if report.duration is not None else sum(t.duration for t in report.tests)
    out.append(f"| {len(report.tests)} | {counts.get('passed', 0)} | {counts.get('failed', 0)} | {counts.get('error', 0)} | {counts.get('skipped', 0)} | {fmt_duration(duration)} |")
    out.append("")

    if problems:
        out += ["### Failures", ""]
        for test in problems:
            out += [f"<details><summary>{ICONS[test.outcome]} <code>{test.group}</code> › {test.name}</summary>", ""]
            out += [code_block(test.message or "(no details)"), "", "</details>", ""]

    groups: dict[str, list[Test]] = {}
    for test in report.tests:
        groups.setdefault(test.group, []).append(test)

    out += ["### All tests", ""]
    for group, tests in groups.items():
        failed = sum(t.outcome in ("failed", "error") for t in tests)
        passed = sum(t.outcome == "passed" for t in tests)
        icon = "❌" if failed else "✅"
        out += [
            f"<details><summary>{icon} <code>{group}</code> ({passed}/{len(tests)} passed, {fmt_duration(sum(t.duration for t in tests))})</summary>",
            "",
            "| | Test | Duration |",
            "| --- | --- | ---: |",
        ]
        for test in tests:
            name = test.name.replace("|", "\\|")
            out.append(f"| {ICONS.get(test.outcome, '❔')} | {name} | {fmt_duration(test.duration)} |")
        out += ["", "</details>", ""]
    return "\n".join(out)


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[1] not in ("pytest", "frida-test"):
        print(__doc__, file=sys.stderr)
        return 2
    fmt, path, title = sys.argv[1], Path(sys.argv[2]), sys.argv[3]

    if not path.is_file() or path.stat().st_size == 0:
        markdown = f"## {title}: ❌ No results\n\n`{path}` was not written, the tests did not run to completion.\n"
    else:
        report = parse_pytest(path) if fmt == "pytest" else parse_frida_test(path)
        markdown = render(report, title)

    summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_file:
        with open(summary_file, "a", encoding="utf-8") as f:
            f.write(markdown + "\n")
    else:
        print(markdown)
    return 0


if __name__ == "__main__":
    sys.exit(main())
