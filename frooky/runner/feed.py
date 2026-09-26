from __future__ import annotations

import math
import time
from datetime import datetime
from typing import Callable, Optional

from rich.console import Console, ConsoleOptions, RenderResult
from rich.live import Live
from rich.spinner import Spinner
from rich.table import Table
from rich.text import Text

from ..pp_hook_event import format_hook_event

# the colors the agent's logger used before it left the rendering to the host
LEVEL_STYLES = {
    "debug": "green",
    "info": "blue",
    "warn": "yellow",
    "error": "red",
}

# Frida reports console.warn() as "warning"
_LEVEL_ALIASES = {"warning": "warn"}


def normalize_level(level: str) -> str:
    level = level.lower()
    return _LEVEL_ALIASES.get(level, level)


class HookStatus:
    """The hooks segment at the start of the status bar, e.g.
    `Resolving hooks: 38 hooked, 4 classes/modules pending (gives up in 3s)`, then `Hooks: 38`.

    It is busy (the bar shows a spinner) until the agent's first progress report and while anything
    is pending. The countdown restarts whenever resolving starts again, e.g. on a reload, and is
    recomputed on every redraw.
    """

    def __init__(self, timeout_seconds: float, clock: Callable[[], float] = time.monotonic):
        self.hooked = 0
        self.pending = 0
        self._reported = False
        self._timeout_seconds = timeout_seconds
        self._clock = clock
        self._deadline = clock() + timeout_seconds

    def update(self, hooked: int, pending: int) -> None:
        if pending > 0 and self._reported and self.pending == 0:
            self._deadline = self._clock() + self._timeout_seconds
        self.hooked = hooked
        self.pending = pending
        self._reported = True

    @property
    def busy(self) -> bool:
        return not self._reported or self.pending > 0

    def describe(self) -> str:
        if not self._reported:
            return "Loading hooks..."
        if self.pending == 0:
            return f"Hooks: {self.hooked:,}"
        text = f"Resolving hooks: {self.hooked:,} hooked, {self.pending} classes/modules pending"
        seconds_left = math.ceil(self._deadline - self._clock())
        return f"{text} (gives up in {seconds_left}s)" if seconds_left > 0 else text


class _StatusBar:
    """Renders the feed's status bar on every redraw of the live area, so the spinner and countdown move."""

    def __init__(self, feed: Feed):
        self._feed = feed
        self._spinner = Spinner("dots")

    def build(self, now: float) -> Text:
        hook_status = self._feed._hook_status
        if hook_status is None and not self._feed._status:
            return Text("", end="")
        bar = Text(" ", style="reverse", no_wrap=True, overflow="ellipsis", end="")
        if hook_status is not None:
            bar.append_text(self._spinner.render(now) if hook_status.busy else Text("✓"))
            bar.append(f" {hook_status.describe()}  |  ")
        bar.append(f"{self._feed._status} ")
        return bar

    def __rich_console__(self, console: Console, options: ConsoleOptions) -> RenderResult:
        yield self.build(console.get_time())


class Feed:
    """The terminal output of a run: a scrolling feed of log lines and events above a status bar.

    The status bar at the bottom is redrawn in place: an optional HookStatus segment, with a spinner
    while hooks resolve, followed by the status text. Every other output of a run goes through here,
    so log lines from the agent, the host and user scripts share one format. The methods are safe to
    call from Frida's callback threads.
    """

    def __init__(self, console: Optional[Console] = None):
        self.console = console or Console(highlight=False)
        self._hook_status: Optional[HookStatus] = None
        self._status = ""
        self._status_bar = _StatusBar(self)
        self._live = Live(self._status_bar, console=self.console, refresh_per_second=8, transient=False)

    def start(self) -> None:
        self._live.start()

    def stop(self) -> None:
        self._live.stop()

    def print(self, text: str = "") -> None:
        """Print plain text, e.g. the header, without a timestamp or level. Long lines are left to the terminal to wrap."""
        self.console.print(Text(text), soft_wrap=True)

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
        for line in format_hook_event(event, self.console.width):
            self.console.print(Text.from_ansi(line), no_wrap=True, crop=True)

    def status(self, text: str) -> None:
        """Replace the status text in the status bar; it shows on the next redraw."""
        self._status = text

    def hook_status(self, hook_status: Optional[HookStatus]) -> None:
        """Show a HookStatus at the start of the status bar; the bar reads it on every redraw."""
        self._hook_status = hook_status

    def render_status_bar(self) -> Text:
        """The status bar as it is drawn right now."""
        return self._status_bar.build(self.console.get_time())
