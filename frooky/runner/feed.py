from __future__ import annotations

import math
import time
from collections import deque
from datetime import datetime
from typing import Callable, Optional

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

# Frida reports console.warn() as "warning"
_LEVEL_ALIASES = {"warning": "warn"}


def normalize_level(level: str) -> str:
    level = level.lower()
    return _LEVEL_ALIASES.get(level, level)


class HookStatus:
    """The hooks segment of the status bar, e.g.
    `Resolving hooks: 38 hooked, 4 modules pending (gives up in 3s)`, then `# Hooks 38 (2 not resolved)`.

    It is busy (the bar shows a spinner) until the agent's first progress report and while anything
    is pending. The countdown restarts whenever resolving starts again, e.g. on a reload, and is
    recomputed on every redraw.
    """

    def __init__(self, timeout_seconds: float, clock: Callable[[], float] = time.monotonic):
        self.hooked = 0
        self.pending = 0
        self.failed = 0
        self._reported = False
        self._timeout_seconds = timeout_seconds
        self._clock = clock
        self._deadline = clock() + timeout_seconds

    def update(self, hooked: int, pending: int, failed: int = 0) -> None:
        if pending > 0 and self._reported and self.pending == 0:
            self._deadline = self._clock() + self._timeout_seconds
        self.hooked = hooked
        self.pending = pending
        self.failed = failed
        self._reported = True

    @property
    def busy(self) -> bool:
        return not self._reported or self.pending > 0

    def describe(self) -> str:
        if not self._reported:
            return "Loading hooks..."
        if self.pending == 0:
            text = f"Hooks ready: {self.hooked:,} hooked"
            return f"{text}, {self.failed:,} not resolved" if self.failed else text
        text = f"Resolving hooks: {self.hooked:,} hooked, {self.pending} {'module' if self.pending == 1 else 'modules'} pending"
        seconds_left = math.ceil(self._deadline - self._clock())
        return f"{text} (gives up in {seconds_left}s)" if seconds_left > 0 else text


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
    # the event rate is averaged over this many seconds
    RATE_WINDOW_SECONDS = 5.0
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
        return (count - count_then) / (now - since) if now - since >= 1 else 0.0

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
                if hook_status.failed:
                    hooks.append(f" ({hook_status.failed:,} not resolved)", style="bold gold1 on grey23")
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

    def start(self) -> None:
        self._started_at = self.console.get_time()
        self._live.start()

    def stop(self) -> None:
        self._live.stop()

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
        text.append_text(Text.from_ansi(message.rstrip("\n"), style=style))

        line = Table.grid(padding=(0, 2))
        line.add_column(no_wrap=True)
        line.add_column(no_wrap=True, width=5)
        line.add_column(overflow="fold")
        line.add_row(Text(datetime.now().strftime("%H:%M:%S"), style="dim"), Text(level.upper(), style=f"bold {style}"), text)
        self.console.print(line)

    def event(self, event: dict) -> None:
        """Print a hook event as a box as wide as the terminal."""
        lines = format_hook_event(event, self.console.width)
        self.console.print(Text.from_ansi("\n".join(lines)), no_wrap=True, crop=True)

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
