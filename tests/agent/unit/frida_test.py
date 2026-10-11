"""pytest plugin that collects the agent's frida-test suites (`frooky/agent/src/**/*.test.ts`) as pytest items.

The tests stay next to the agent code. pytest lists them under this folder, so they sit next to the host tests,
e.g. in the VS Code Testing view: `tests/agent/unit/shared/utils.test.ts` stands for `frooky/agent/src/shared/utils.test.ts`.
All selected tests run in one frida-test run on the device `scripts/test-android.sh` picks (`ANDROID_SERIAL`).
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path

import pytest

UNIT_DIR = Path(__file__).parent
AGENT_DIR = Path(__file__).parents[3] / "frooky" / "agent"
AGENT_SRC = AGENT_DIR / "src"

# `describe("title", ...` or `it("title", ...` at the start of a line; Prettier's indentation gives the nesting
TEST_CALL = re.compile(r"""^(\s*)(describe|it|test)\(\s*(["'`])((?:\\.|(?!\3).)*)\3""")
# e.g. `${kind}` in a template literal title
PLACEHOLDER = re.compile(r"\$\{[^}]*\}")
# lines of frida-test's output to show when it wrote no report, e.g. without a device or on a compile error
OUTPUT_TAIL_LINES = 30

RUN_KEY = pytest.StashKey["AgentTestRun"]()


class AgentTestFailure(Exception):
    pass


def _title_pattern(quote, raw):
    """Regex for the titles a `describe()`/`it()` title has at runtime; placeholders of a template literal match anything."""
    literals = PLACEHOLDER.split(raw) if quote == "`" else [raw]
    return re.compile(".*".join(re.escape(re.sub(r"\\(.)", r"\1", literal)) for literal in literals), re.DOTALL)


def _matches(patterns, titles):
    return len(patterns) == len(titles) and all(pattern.fullmatch(title) for pattern, title in zip(patterns, titles))


def _error_text(titles, result):
    error = result.get("error") or {}
    return f"{' > '.join(titles)}\n{error.get('stack') or error.get('message') or result['status']}"


def _flatten(result, parents=()):
    """Yields `(titles, result)` for a frida-test result and everything below it, e.g. `(("Utils", "matches '*'"), {...})`."""
    titles = (*parents, result["name"])
    yield titles, result
    for child in result.get("children") or []:
        yield from _flatten(child, titles)


class AgentTestRun:
    """One frida-test run over the files of all selected agent tests."""

    def __init__(self, items):
        self.nodes = []
        self.output = ""
        files = sorted({str(item.path) for item in items})
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "report.json"
            process = subprocess.run(["bash", "scripts/test-android.sh", "-o", str(report), *files], cwd=AGENT_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=False)
            self.output = process.stdout
            if report.exists():
                for suite in json.loads(report.read_text(encoding="utf8"))["testSuitesResults"]:
                    self.nodes.extend(_flatten(suite["testResult"]))
        # failures no test in the source matches, e.g. an `afterAll hook` or a test registered by a helper function
        self.unclaimed = [(titles, result) for titles, result in self.nodes if result["status"] == "failed" and not result.get("children") and not any(_matches(item.patterns, titles) for item in items)]

    def results_for(self, patterns):
        """The results of a test, plus the failures around it that belong to no test."""
        results = [(titles, result) for titles, result in self.nodes if _matches(patterns, titles)]
        if not results:
            # a describe() that threw reports nothing for the tests it didn't get to register
            results = [(titles, result) for titles, result in self.nodes if "error" in result and len(titles) < len(patterns) and _matches(patterns[: len(titles)], titles)]
        return results + [(titles, result) for titles, result in self.unclaimed if _matches(patterns[: len(titles) - 1], titles[:-1])]


class AgentTestItem(pytest.Item):
    def __init__(self, *, patterns, line, **kwargs):
        super().__init__(**kwargs)
        self.patterns = patterns
        self.line = line

    def runtest(self):
        run = self.session.stash.get(RUN_KEY, None)
        if run is None:
            run = self.session.stash[RUN_KEY] = AgentTestRun([item for item in self.session.items if isinstance(item, AgentTestItem)])
            print(run.output)
        if not run.nodes:
            raise AgentTestFailure("frida-test reported no results:\n" + "\n".join(run.output.splitlines()[-OUTPUT_TAIL_LINES:]))
        results = run.results_for(self.patterns)
        if not results:
            raise AgentTestFailure("frida-test reported no result for this test")
        failed = [_error_text(titles, result) for titles, result in results if result["status"] == "failed"]
        if failed:
            raise AgentTestFailure("\n\n".join(failed))
        if all(result["status"] == "skipped" for _, result in results):
            pytest.skip("skipped by frida-test")

    def repr_failure(self, excinfo, style=None):
        if isinstance(excinfo.value, AgentTestFailure):
            return str(excinfo.value)
        return super().repr_failure(excinfo, style)

    def reportinfo(self):
        return self.path, self.line - 1, self.name


class AgentTestFile(pytest.File):
    """A `*.test.ts` file: `source` itself, or its stand-in below tests/agent/unit."""

    def __init__(self, *, source, **kwargs):
        super().__init__(**kwargs)
        self.source = source

    def collect(self):
        source_id = self.source.relative_to(self.config.rootpath).as_posix()
        # the open describe() blocks as (indentation, title, pattern)
        describes = []
        for line_number, line in enumerate(self.source.read_text(encoding="utf8").splitlines(), 1):
            match = TEST_CALL.match(line)
            if not match:
                continue
            indentation, kind, quote, raw = len(match[1]), match[2], match[3], match[4]
            while describes and describes[-1][0] >= indentation:
                describes.pop()
            if kind == "describe":
                describes.append((indentation, raw, _title_pattern(quote, raw)))
                continue
            # pytest splits node ids at `::`, so a title can't contain it
            name = " > ".join([*(title for _, title, _ in describes), raw]).replace("::", ":")
            patterns = (*(pattern for _, _, pattern in describes), _title_pattern(quote, raw))
            # path and id are the source's, so a test opens and reruns as `frooky/agent/src/....test.ts::<name>`
            yield AgentTestItem.from_parent(self, name=name, path=self.source, nodeid=f"{source_id}::{name}", patterns=patterns, line=line_number)


class AgentUnitDirectory(pytest.Directory):
    def collect(self):
        for source in sorted(AGENT_SRC.rglob("*.test.ts")):
            yield AgentTestFile.from_parent(self, path=self.path / source.relative_to(AGENT_SRC), source=source)


def pytest_collect_directory(path, parent):
    if path == UNIT_DIR:
        return AgentUnitDirectory.from_parent(parent, path=path)
    return None


def pytest_collect_file(parent, file_path):
    # reached when a test is selected by its id
    if file_path.name.endswith(".test.ts") and file_path.is_relative_to(AGENT_SRC):
        return AgentTestFile.from_parent(parent, path=file_path, source=file_path)
    return None
