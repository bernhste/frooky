from __future__ import annotations

import queue
import re
import threading
from collections import deque
from contextlib import contextmanager
from datetime import datetime
from typing import Iterator, Optional

from rich.console import Console, ConsoleOptions, RenderResult
from rich.live import Live
from rich.spinner import Spinner
from rich.table import Table
from rich.text import Text

from ..pp_hook_event import format_hook_event

# Mid-tone colors from the fixed 256-color palette that stay readable on dark and light terminal
# backgrounds; the 16 ANSI colors (e.g. "yellow") are redefined by every theme and often aren't.
LEVEL_STYLES = {
    "debug": "color(64)",
    "info": "color(32)",
    "warn": "color(136)",
    "error": "color(167)",
}

# Colors that tell neighboring items apart: the agent's `Decoded ...` debug logs, one per hook call, and the
# hook statistics rows, one per hook file. Clearly different hues in the same mid-tone range as LEVEL_STYLES
# and distinct from them.
ACCENT_STYLES = [
    "color(30)",  # teal
    "color(173)",  # salmon
    "color(97)",  # purple
    "color(179)",  # sand
    "color(67)",  # steel blue
    "color(132)",  # plum
    "color(108)",  # sage
    "color(139)",  # mauve
    "color(61)",  # slate blue
    "color(137)",  # tan
    "color(72)",  # sea green
    "color(134)",  # orchid
]

# Captures the hook call number, e.g. `42` in
# `Decoded [call 42] com.example.Foo.bar param #0 'key' (java.lang.String, PrimitiveDecoder): "abc"` or
# `Decoded decoderArgs 'length: count' of [call 42] libc.so!write param #1 'buf' (size_t, NativeValueDecoder): 8`
_DECODED_LOG_PATTERN = re.compile(r"^Decoded .*?\[call (\d+)\] ")

# Frida reports console.warn() as "warning"
_LEVEL_ALIASES = {"warning": "warn"}


def normalize_level(level: str) -> str:
    level = level.lower()
    return _LEVEL_ALIASES.get(level, level)


class HookStatus:
    """The hooks segment of the status bar, e.g.
    `Resolving hooks: 38 hooked, 4 resolving`, then `# Hooks 38 (1 waiting, 2 not found)`.

    It is busy (the bar shows a spinner) until the agent's first progress report and while anything
    is resolving. Once the lookups at the target's start (targetReady) have run, the agent reports classes
    and modules that haven't loaded as waiting: their hooks are installed whenever they load.
    """

    def __init__(self):
        self.hooked = 0
        self.resolving = 0
        self.waiting = 0
        self.not_found = 0
        self._reported = False

    def update(self, hooked: int, resolving: int, not_found: int = 0, waiting: int = 0) -> None:
        self.hooked = hooked
        self.resolving = resolving
        self.waiting = waiting
        self.not_found = not_found
        self._reported = True

    @property
    def busy(self) -> bool:
        return not self._reported or self.resolving > 0

    def describe(self) -> str:
        if not self._reported:
            return "Loading hooks..."
        if self.resolving == 0:
            return ", ".join([f"Hooks ready: {self.hooked:,} hooked", *self.describe_unhooked()])
        return f"Resolving hooks: {self.hooked:,} hooked, {self.resolving:,} resolving"

    def describe_unhooked(self) -> list[str]:
        """e.g. `["1 waiting", "2 not found"]`"""
        parts = []
        if self.waiting:
            parts.append(f"{self.waiting:,} waiting")
        if self.not_found:
            parts.append(f"{self.not_found:,} not found")
        return parts


# the agent's HookStatistic states, in the order the hook statistics list them
_STATISTIC_STATES = {"installed": "hooked", "waiting": "waiting", "resolving": "resolving", "notFound": "not found"}


def format_hook_statistics(statistics: list[dict]) -> Table:
    """The table the `i` key prints: one row per hook declaration (see HookStatistic in FrookyAgent.ts), hooked ones
    first, with the overloads it hooks (Java hooks only), their events, the calls their filters dropped and the time spent
    decoding the values of their events, or the class or module it waits for. The `Waits for` column only shows while
    a declaration waits, so the table fits narrower terminals. Rows are colored per hook file."""
    table = Table(box=None, padding=(0, 2), pad_edge=False, header_style="bold", title="Hook statistics", title_justify="left", title_style="bold")
    table.add_column("State", no_wrap=True)
    table.add_column("Overloads", justify="right", no_wrap=True)
    table.add_column("Events", justify="right", no_wrap=True)
    table.add_column("Filtered", justify="right", no_wrap=True)
    table.add_column("Decoding time (sum)", justify="right")
    table.add_column("Target", overflow="fold")
    table.add_column("File", no_wrap=True)
    any_waiting = any(row["state"] in ("waiting", "resolving") for row in statistics)
    if any_waiting:
        table.add_column("Waits for", overflow="fold")
    order = list(_STATISTIC_STATES)
    rows = sorted(statistics, key=lambda row: (order.index(row["state"]) if row["state"] in order else len(order), row["config"], row["target"]))
    # by sorted file name, so a file keeps its color across prints while the states change
    file_styles = {config: ACCENT_STYLES[i % len(ACCENT_STYLES)] for i, config in enumerate(sorted({row["config"] for row in rows}))}
    for row in rows:
        installed = row["state"] == "installed"
        waiting = row["state"] in ("waiting", "resolving")
        cells = [
            Text(_STATISTIC_STATES.get(row["state"], row["state"]), style="" if installed else "bold gold1"),
            f"{row['overloads']:,}" if installed and row.get("overloads") is not None else "-",
            f"{row['events']:,}" if installed else "-",
            f"{row.get('filtered', 0):,}" if installed else "-",
            _format_milliseconds(row.get("decodeMs", 0)) if installed else "-",
            row["target"],
            row["config"],
        ]
        if any_waiting:
            cells.append(row["waitsFor"] if waiting else "")
        table.add_row(*cells, style=file_styles[row["config"]])
    if not rows:
        table.add_row("-", "-", "-", "-", "-", "no hooks loaded", "")
    return table


def _format_milliseconds(milliseconds: float) -> str:
    """e.g. `850 ms` or `12.3 s`"""
    return f"{milliseconds:,.0f} ms" if milliseconds < 1000 else f"{milliseconds / 1000:,.1f} s"


def _format_duration(seconds: float) -> str:
    minutes, seconds = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}:{minutes:02}:{seconds:02}" if hours else f"{minutes:02}:{seconds:02}"


def _format_rate(rate: float) -> str:
    return f"{rate:,.0f}/s" if rate >= 10 or rate == 0 else f"{rate:.1f}/s"


class _StatusBar:
    """Renders the feed's status bar on every redraw of the live area, so the spinner, countdown, rate and
    elapsed time move. It spans the whole terminal width: the hook segment and the last event on the left,
    cropped with an ellipsis when they don't fit, and the event count, event rate and elapsed time on the right.
    """

    # colors from the fixed 256-color palette, not the 16 ANSI colors that light terminal themes redefine
    STYLE = "grey93 on grey23"
    LABEL_STYLE = "grey66 on grey23"
    VALUE_STYLE = "bold grey93 on grey23"
    SEPARATOR = "  │  "
    # the event rate is averaged over this many seconds; the agent sends events in batches every 100 ms,
    # so shorter windows make the rate jump between batches
    RATE_WINDOW_SECONDS = 1.0
    # values are right-aligned in fixed widths so the bar doesn't jump as they grow,
    # up to 999 hooks, 999,999 events and 1,000/s
    HOOKS_WIDTH = len("999")
    EVENTS_WIDTH = len("999,999")
    RATE_WIDTH = len("1,000/s")

    def __init__(self, feed: Feed):
        self._feed = feed
        self._spinner = Spinner("dots", style="turquoise2")
        self._samples: deque[tuple[float, int]] = deque()

    def _rate(self, now: float, count: int) -> float:
        self._samples.append((now, count))
        while len(self._samples) > 1 and now - self._samples[0][0] > self.RATE_WINDOW_SECONDS:
            self._samples.popleft()
        since, count_then = self._samples[0]
        return (count - count_then) / (now - since) if now - since >= self.RATE_WINDOW_SECONDS / 2 else 0.0

    def _segments(self, segments: list[Text]) -> Text:
        text = Text(style=self.STYLE)
        for i, segment in enumerate(segments):
            if i:
                text.append(self.SEPARATOR, style="grey42 on grey23")
            text.append_text(segment)
        return text

    def _field(self, label: str, value: str) -> Text:
        return Text.assemble((f"{label} ", self.LABEL_STYLE), (value, self.VALUE_STYLE))

    def build(self, now: float, width: int) -> Text:
        feed = self._feed
        hook_status = feed._hook_status
        if hook_status is None and feed._event_count is None:
            return Text("", end="")

        left: list[Text] = []
        if hook_status is not None:
            if hook_status.busy:
                left.append(Text.assemble(self._spinner.render(now), " ", (hook_status.describe(), "bold gold1 on grey23")))
            else:
                hooks = self._field("# Hooks", f"{hook_status.hooked:,}".rjust(self.HOOKS_WIDTH))
                unhooked = hook_status.describe_unhooked()
                if unhooked:
                    hooks.append(f" ({', '.join(unhooked)})", style="bold gold1 on grey23")
                left.append(hooks)
        right: list[Text] = []
        if feed._event_count is not None:
            left.append(self._field("Last Event", feed._last_event))
            right.append(self._field("# Events", f"{feed._event_count:,}".rjust(self.EVENTS_WIDTH)))
            right.append(self._field("Event Rate", _format_rate(self._rate(now, feed._event_count)).rjust(self.RATE_WIDTH)))
        if feed._started_at is not None:
            right.append(self._field("Running", _format_duration(now - feed._started_at)))

        left_text = self._segments(left)
        right_text = self._segments(right)
        room = width - 2 - right_text.cell_len - (2 if right else 0)
        if left_text.cell_len > room:
            left_text.truncate(max(room, 0), overflow="ellipsis")

        bar = Text(" ", style=self.STYLE, no_wrap=True, overflow="ellipsis", end="")
        bar.append_text(left_text)
        bar.append(" " * max(width - 2 - left_text.cell_len - right_text.cell_len, 0))
        bar.append_text(right_text)
        bar.append(" ")
        bar.truncate(width, overflow="ellipsis")
        return bar

    def __rich_console__(self, console: Console, options: ConsoleOptions) -> RenderResult:
        yield self.build(console.get_time(), options.max_width)


class Feed:
    """The terminal output of a run: a scrolling feed of log lines and events above a status bar.

    The status bar at the bottom is redrawn in place: an optional HookStatus segment, with a spinner
    while hooks resolve, the last event, the event count, the event rate and the elapsed time. Every other output of a run goes through here,
    so log lines from the agent, the host and user scripts share one format. The methods are safe to
    call from Frida's callback threads.
    """

    def __init__(self, console: Optional[Console] = None):
        self.console = console or Console(highlight=False)
        self._hook_status: Optional[HookStatus] = None
        self._event_count: Optional[int] = None
        self._last_event = ""
        self._started_at: Optional[float] = None
        self._status_bar = _StatusBar(self)
        self._live = Live(self._status_bar, console=self.console, refresh_per_second=8, transient=False)
        self._event_queue: queue.Queue[Optional[dict]] = queue.Queue()
        self._printer_thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._started_at = self.console.get_time()
        self._printer_thread = threading.Thread(target=self._process_event_queue, daemon=True)
        self._printer_thread.start()
        self._live.start()

    def stop(self) -> None:
        if self._printer_thread is not None and self._printer_thread.is_alive():
            self._event_queue.put(None)
            self._printer_thread.join(timeout=2.0)
            self._printer_thread = None
        self._live.stop()

    @contextmanager
    def paused(self) -> Iterator[None]:
        """Remove the status bar while the user is asked something on the terminal."""
        self._live.transient = True
        self._live.stop()
        try:
            yield
        finally:
            self._live.transient = False
            self._live.start()

    def print(self, text: str | Text = "") -> None:
        """Print text, e.g. the header, without a timestamp or level. Long lines are left to the terminal to wrap."""
        self.console.print(Text(text) if isinstance(text, str) else text, soft_wrap=True)

    def log(self, level: str, message: str, source: Optional[str] = None) -> None:
        """Print a log line: `HH:MM:SS  LEVEL  [source] message`, colored by level."""
        level = normalize_level(level)
        style = LEVEL_STYLES.get(level, "")

        text = Text()
        if source:
            text.append(f"[{source}] ", style="dim")
        # user scripts may still color their console output themselves
        text.append_text(Text.from_ansi(message.rstrip("\n"), style=self._decoder_style(message) or style))

        line = Table.grid(padding=(0, 2))
        line.add_column(no_wrap=True)
        line.add_column(no_wrap=True, width=5)
        line.add_column(overflow="fold")
        line.add_row(Text(datetime.now().strftime("%H:%M:%S"), style="dim"), Text(level.upper(), style=f"bold {style}"), text)
        self.console.print(line)

    def _decoder_style(self, message: str) -> Optional[str]:
        """The color of a `Decoded ...` log message: the next color for each hook call, so neighboring calls differ."""
        match = _DECODED_LOG_PATTERN.match(message)
        if not match:
            return None
        return ACCENT_STYLES[int(match.group(1)) % len(ACCENT_STYLES)]

    def hook_statistics(self, statistics: list[dict]) -> None:
        """Print the hook statistics table, see format_hook_statistics()."""
        self.console.print(format_hook_statistics(statistics))

    def _process_event_queue(self) -> None:
        while True:
            item = self._event_queue.get()
            if item is None:
                self._event_queue.task_done()
                break
            try:
                self._print_event(item)
            except Exception:
                pass
            finally:
                self._event_queue.task_done()

    def _print_event(self, event: dict) -> None:
        lines = format_hook_event(event, self.console.width)
        self.console.print(Text.from_ansi("\n".join(lines)), no_wrap=True, crop=True)

    def event(self, event: dict) -> None:
        """Print a hook event as a box as wide as the terminal."""
        if self._printer_thread is not None and self._printer_thread.is_alive():
            self._event_queue.put(event)
        else:
            self._print_event(event)

    def status(self, event_count: int, last_event: str) -> None:
        """Update the event count and the last event in the status bar; they show on the next redraw."""
        self._event_count = event_count
        self._last_event = last_event

    def hook_status(self, hook_status: Optional[HookStatus]) -> None:
        """Show a HookStatus in the status bar; the bar reads it on every redraw."""
        self._hook_status = hook_status

    def render_status_bar(self) -> Text:
        """The status bar as it is drawn right now."""
        return self._status_bar.build(self.console.get_time(), self.console.width)
