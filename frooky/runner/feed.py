from __future__ import annotations

from datetime import datetime
from typing import Optional

from rich.console import Console
from rich.live import Live
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


class Feed:
    """The terminal output of a run: a scrolling feed of log lines and events above a live status bar.

    Every output of a run goes through here, so log lines from the agent, the host and user scripts
    share one format. The methods are safe to call from Frida's callback threads.
    """

    def __init__(self, console: Optional[Console] = None):
        self.console = console or Console(highlight=False)
        self._live = Live("", console=self.console, refresh_per_second=4, transient=False)

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
        """Replace the status bar at the bottom."""
        self._live.update(Text(text, style="reverse"))
