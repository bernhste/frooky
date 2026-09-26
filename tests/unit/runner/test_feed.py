"""Unit tests for the terminal feed."""

import io
import re

from rich.console import Console

from frooky.runner.feed import Feed, normalize_level


def make_feed(width=100, color=False):
    buffer = io.StringIO()
    console = Console(file=buffer, width=width, force_terminal=color, color_system="standard" if color else None, highlight=False)
    return Feed(console), buffer


class TestNormalizeLevel:
    def test_frida_warning_becomes_warn(self):
        assert normalize_level("warning") == "warn"

    def test_is_case_insensitive(self):
        assert normalize_level("ERROR") == "error"


class TestLog:
    def test_prints_time_level_and_message(self):
        feed, buffer = make_feed()

        feed.log("info", "hooked 3 methods")

        assert re.match(r"^\d\d:\d\d:\d\d  INFO   hooked 3 methods\s*$", buffer.getvalue())

    def test_frida_warning_level_is_printed_as_warn(self):
        feed, buffer = make_feed()

        feed.log("warning", "careful")

        assert "WARN   careful" in buffer.getvalue()

    def test_prefixes_source(self):
        feed, buffer = make_feed()

        feed.log("info", "hello", "script.js")

        assert "INFO   [script.js] hello" in buffer.getvalue()

    def test_continuation_lines_align_with_the_message(self):
        feed, buffer = make_feed()

        feed.log("debug", "first\nsecond")

        lines = buffer.getvalue().splitlines()
        assert lines[0].index("first") == lines[1].index("second")

    def test_colors_level_and_message(self):
        feed, buffer = make_feed(color=True)

        feed.log("error", "boom")

        # red (31) for both the level tag and the message
        assert buffer.getvalue().count("31m") >= 2

    def test_strips_trailing_newline(self):
        feed, buffer = make_feed()

        feed.log("info", "done\n")

        assert len(buffer.getvalue().splitlines()) == 1


class TestEvent:
    def test_box_fills_the_console_width(self):
        feed, buffer = make_feed(width=90)

        feed.event({"type": "native-hook", "module": "libc.so", "symbol": "strcpy"})

        lines = buffer.getvalue().splitlines()
        assert lines[0].startswith("┌─ native ")
        assert len(lines[0]) == 90
        assert len(lines[-1]) == 90
        assert any("strcpy()" in line for line in lines)


class TestPrint:
    def test_prints_plain_text(self):
        feed, buffer = make_feed()

        feed.print("  Stopped: [red]x[/red]")

        assert buffer.getvalue() == "  Stopped: [red]x[/red]\n"
