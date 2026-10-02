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

    def test_colors_decoder_messages_per_hook_call(self):
        feed, buffer = make_feed(width=200, color=True)

        feed.log("debug", "Decoded [call 1] com.example.Foo.bar param #0 'key' (java.lang.String, PrimitiveDecoder): \"a\"")
        feed.log("debug", "Decoded [call 2] com.example.Foo.bar param #0 'key' (java.lang.String, PrimitiveDecoder): \"b\"")
        feed.log("debug", "Decoded decoderArgs 'length: count' of [call 1] libc.so!write param #1 'buf' (size_t, NativeValueDecoder): 8")
        feed.log("debug", "Decoded [call 1] com.example.Foo.bar return value (int, PrimitiveDecoder): 1")

        lines = buffer.getvalue().splitlines()
        message_colors = [re.findall(r"38;5;(\d+)m", line)[-1] for line in lines]
        assert message_colors[0] == message_colors[2] == message_colors[3]
        assert message_colors[0] != message_colors[1]
        assert message_colors[0] != "64"

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
        assert status.describe() == "Resolving hooks: 38 hooked, 4 pending (3s)"

    def test_leaves_out_the_countdown_once_the_report_delay_passed(self):
        status, now = self.make()
        status.update(38, 4)
        now[0] = 106.0

        assert status.describe() == "Resolving hooks: 38 hooked, 4 pending"

    def test_describes_the_hook_count_when_nothing_is_pending(self):
        status, _now = self.make()
        status.update(1200, 0)

        assert not status.busy
        assert status.describe() == "Hooks ready: 1,200 hooked"

    def test_describes_hooks_that_failed_to_resolve(self):
        status, _now = self.make()
        status.update(14, 0, 1)

        assert status.describe() == "Hooks ready: 14 hooked, 1 not resolved"

    def test_is_ready_while_hooks_wait_for_their_class_or_module(self):
        status, _now = self.make()
        status.update(14, 0, 1, 2)

        assert not status.busy
        assert status.describe() == "Hooks ready: 14 hooked, 2 waiting, 1 not resolved"

    def test_restarts_the_countdown_when_resolving_starts_again(self):
        status, now = self.make()
        status.update(38, 0)
        now[0] = 200.0
        status.update(38, 1)
        now[0] = 201.0

        assert status.describe().endswith("(4s)")


class TestHookStatistics:
    STATISTICS = [
        {"config": "hooks.yaml", "target": "com.example.Late.run", "state": "waiting", "waitsFor": "Java class 'com.example.Late'", "hooked": 0, "events": 0, "filtered": 0, "decodeMs": 0},
        {"config": "hooks.yaml", "target": "libc.so!nope", "state": "failed", "waitsFor": "Module 'libc.so'", "hooked": 0, "events": 0, "filtered": 0, "decodeMs": 0},
        {"config": "hooks.yaml", "target": "libc.so!open", "state": "installed", "waitsFor": "Module 'libc.so'", "hooked": 1, "events": 1234, "filtered": 56789, "decodeMs": 2345},
    ]

    def test_lists_hooked_declarations_first_with_their_events(self):
        feed, buffer = make_feed(width=140)

        feed.hook_statistics(self.STATISTICS)

        lines = [line.rstrip() for line in buffer.getvalue().splitlines()]
        assert lines[0] == "Hook statistics"
        assert re.match(r"^State\s+Hooks\s+Events\s+Filtered\s+Decoding time \(sum\)\s+Target\s+File\s+Waits for$", lines[1])
        assert re.match(r"^hooked\s+1\s+1,234\s+56,789\s+2\.3 s\s+libc\.so!open\s+hooks\.yaml$", lines[2])
        assert re.match(r"^waiting\s+-\s+-\s+-\s+-\s+com\.example\.Late\.run\s+hooks\.yaml\s+Java class 'com\.example\.Late'$", lines[3])
        assert re.match(r"^not resolved\s+-\s+-\s+-\s+-\s+libc\.so!nope\s+hooks\.yaml$", lines[4])

    def test_says_so_when_no_hooks_are_loaded(self):
        feed, buffer = make_feed()

        feed.hook_statistics([])

        assert "no hooks loaded" in buffer.getvalue()


class TestStatusBar:
    def make(self, width=100, hooked=38, pending=0, failed=0, waiting=0):
        feed, _buffer = make_feed(width=width)
        hook_status = HookStatus(5)
        hook_status.update(hooked, pending, failed, waiting)
        feed.hook_status(hook_status)
        feed.status(2264, "libc.so: read")
        return feed

    def test_is_empty_before_anything_is_set(self):
        feed, _buffer = make_feed()

        assert feed.render_status_bar().plain == ""

    def test_shows_a_spinner_and_the_progress_while_resolving(self):
        feed = self.make(width=140, pending=4)

        bar = feed.render_status_bar().plain

        assert re.match(r"^ \S Resolving hooks: 38 hooked, 4 pending .*  │  Last Event libc\.so: read ", bar)
        assert bar.endswith("  # Events   2,264  │  Event Rate     0/s ")

    def test_shows_the_hook_count_without_a_spinner_when_done(self):
        feed = self.make()

        bar = feed.render_status_bar().plain

        assert bar.startswith(" # Hooks  38  │  Last Event libc.so: read ")
        assert bar.endswith("  # Events   2,264  │  Event Rate     0/s ")

    def test_shows_hooks_that_failed_to_resolve(self):
        feed = self.make(failed=2)

        assert feed.render_status_bar().plain.startswith(" # Hooks  38 (2 not resolved)  │  Last Event libc.so: read ")

    def test_shows_hooks_that_wait_for_their_class_or_module(self):
        feed = self.make(width=120, failed=2, waiting=1)

        assert feed.render_status_bar().plain.startswith(" # Hooks  38 (1 waiting, 2 not resolved)  │  Last Event libc.so: read ")

    def test_spans_the_console_width_with_events_rate_and_elapsed_time_on_the_right(self):
        feed = self.make(width=120)
        feed._started_at = feed.console.get_time() - 75

        bar = feed.render_status_bar().plain

        assert len(bar) == 120
        assert bar.endswith("Event Rate     0/s  │  Running 01:15 ")

    def test_keeps_its_width_as_the_numbers_grow(self):
        small = self.make(hooked=1)
        small.status(1, "libc.so: read")
        large = self.make(hooked=999)
        large.status(999_999, "libc.so: read")
        large._status_bar._rate = lambda now, count: 1000.0

        small_bar = small.render_status_bar().plain
        large_bar = large.render_status_bar().plain

        assert large_bar.startswith(" # Hooks 999  │  Last Event ")
        assert large_bar.endswith("  # Events 999,999  │  Event Rate 1,000/s ")
        assert small_bar.index("Last Event") == large_bar.index("Last Event")
        assert small_bar.index("# Events") == large_bar.index("# Events")

    def test_computes_the_event_rate_over_the_last_seconds(self):
        feed = self.make()
        bar = feed._status_bar
        bar.build(100.0, 100)
        feed.status(2264 + 15, "libc.so: read")

        assert "Event Rate   7.5/s" in bar.build(102.0, 100).plain

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
            assert text.endswith("Event Rate     0/s ")
