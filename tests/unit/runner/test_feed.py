"""Unit tests for the terminal feed."""

import io
import re

from rich.console import Console

from frooky.runner.feed import Feed, HookStatus, normalize_level


def make_feed(width=100, color=False):
    buffer = io.StringIO()
    console = Console(file=buffer, width=width, force_terminal=color, color_system="256" if color else None, highlight=False)
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

        # the 256-color red (167) for both the level tag and the message
        assert buffer.getvalue().count("38;5;167m") >= 2

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
        assert status.describe() == "Resolving hooks: 38 hooked, 4 modules pending (gives up in 3s)"

    def test_uses_the_singular_for_one_pending_module(self):
        status, _now = self.make()
        status.update(14, 1)

        assert status.describe().startswith("Resolving hooks: 14 hooked, 1 module pending ")

    def test_leaves_out_the_countdown_once_the_timeout_passed(self):
        status, now = self.make()
        status.update(38, 4)
        now[0] = 106.0

        assert status.describe() == "Resolving hooks: 38 hooked, 4 modules pending"

    def test_describes_the_hook_count_when_nothing_is_pending(self):
        status, _now = self.make()
        status.update(1200, 0)

        assert not status.busy
        assert status.describe() == "Hooks ready: 1,200 hooked"

    def test_describes_hooks_that_failed_to_resolve(self):
        status, _now = self.make()
        status.update(14, 0, 1)

        assert status.describe() == "Hooks ready: 14 hooked, 1 not resolved"

    def test_restarts_the_countdown_when_resolving_starts_again(self):
        status, now = self.make()
        status.update(38, 0)
        now[0] = 200.0
        status.update(38, 1)
        now[0] = 201.0

        assert status.describe().endswith("(gives up in 4s)")


class TestStatusBar:
    def make(self, width=100, hooked=38, pending=0, failed=0):
        feed, _buffer = make_feed(width=width)
        hook_status = HookStatus(5)
        hook_status.update(hooked, pending, failed)
        feed.hook_status(hook_status)
        feed.status(2264, "libc.so: read")
        return feed

    def test_is_empty_before_anything_is_set(self):
        feed, _buffer = make_feed()

        assert feed.render_status_bar().plain == ""

    def test_shows_a_spinner_and_the_progress_while_resolving(self):
        feed = self.make(width=140, pending=4)

        bar = feed.render_status_bar().plain

        assert re.match(r"^ \S Resolving hooks: 38 hooked, 4 modules pending .*  │  # Events 2,264  │  Last Event libc\.so: read ", bar)

    def test_shows_the_hook_count_without_a_spinner_when_done(self):
        feed = self.make()

        assert feed.render_status_bar().plain.startswith(" # Hooks 38  │  # Events 2,264  │  Last Event libc.so: read ")

    def test_shows_hooks_that_failed_to_resolve(self):
        feed = self.make(failed=2)

        assert feed.render_status_bar().plain.startswith(" # Hooks 38 (2 not resolved)  │  # Events 2,264 ")

    def test_spans_the_console_width_with_rate_and_elapsed_time_on_the_right(self):
        feed = self.make(width=120)
        feed._started_at = feed.console.get_time() - 75

        bar = feed.render_status_bar().plain

        assert len(bar) == 120
        assert bar.endswith("Event Rate 0/s  │  Running 01:15 ")

    def test_computes_the_event_rate_over_the_last_seconds(self):
        feed = self.make()
        bar = feed._status_bar
        bar.build(100.0, 100)
        feed.status(2264 + 15, "libc.so: read")

        assert "Event Rate 7.5/s" in bar.build(102.0, 100).plain

    def test_does_not_wrap(self):
        feed, _buffer = make_feed()
        feed.status(1, "x" * 500)

        assert feed.render_status_bar().no_wrap

    def test_crops_the_last_event_and_keeps_the_right_side(self):
        for width in (70, 120):
            feed, _buffer = make_feed(width=width)
            feed.status(1, "x" * 500)

            lines = feed.console.render_lines(feed._status_bar, pad=False)

            assert len(lines) == 1
            text = "".join(segment.text for segment in lines[0])
            assert len(text) == width
            assert "…" in text
            assert text.endswith("Event Rate 0/s ")
