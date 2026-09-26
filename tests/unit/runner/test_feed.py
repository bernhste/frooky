"""Unit tests for the terminal feed."""

import io
import re

from rich.console import Console

from frooky.runner.feed import Feed, HookStatus, normalize_level


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


class TestHookStatus:
    def make(self, timeout=5):
        now = [100.0]
        return HookStatus(timeout, clock=lambda: now[0]), now

    def test_is_loading_until_the_first_report(self):
        status, _now = self.make()

        assert status.busy
        assert status.describe() == "Loading hooks..."

    def test_describes_counts_and_time_left_while_resolving(self):
        status, now = self.make()
        status.update(38, 4)
        now[0] = 102.5

        assert status.busy
        assert status.describe() == "Resolving hooks: 38 hooked, 4 classes/modules pending (gives up in 3s)"

    def test_leaves_out_the_countdown_once_the_timeout_passed(self):
        status, now = self.make()
        status.update(38, 4)
        now[0] = 106.0

        assert status.describe() == "Resolving hooks: 38 hooked, 4 classes/modules pending"

    def test_shows_the_hook_count_when_nothing_is_pending(self):
        status, _now = self.make()
        status.update(1200, 0)

        assert not status.busy
        assert status.describe() == "Hooks: 1,200"

    def test_restarts_the_countdown_when_resolving_starts_again(self):
        status, now = self.make()
        status.update(38, 0)
        now[0] = 200.0
        status.update(38, 1)
        now[0] = 201.0

        assert status.describe().endswith("(gives up in 4s)")


class TestStatusBar:
    def test_is_empty_before_anything_is_set(self):
        feed, _buffer = make_feed()

        assert feed.render_status_bar().plain == ""

    def test_shows_a_spinner_and_the_progress_while_resolving(self):
        feed, _buffer = make_feed()
        hook_status = HookStatus(5)
        hook_status.update(38, 4)
        feed.hook_status(hook_status)
        feed.status("Events: 0")

        bar = feed.render_status_bar().plain

        assert re.match(r"^ \S Resolving hooks: 38 hooked, 4 classes/modules pending .*  \|  Events: 0 $", bar)
        assert "✓" not in bar

    def test_shows_a_check_mark_and_the_hook_count_when_done(self):
        feed, _buffer = make_feed()
        hook_status = HookStatus(5)
        hook_status.update(38, 0)
        feed.hook_status(hook_status)
        feed.status("Events: 0")

        assert feed.render_status_bar().plain == " ✓ Hooks: 38  |  Events: 0 "

    def test_does_not_wrap(self):
        feed, _buffer = make_feed()
        feed.status("x" * 500)

        assert feed.render_status_bar().no_wrap
