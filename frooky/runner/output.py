from __future__ import annotations

import json
from pathlib import Path
from typing import Optional


def describe_event(event: dict) -> Optional[str]:
    """Build a short human-readable label for a hook event, for the live status line."""
    if event.get("symbol"):
        return f"{event.get('module')}: {event.get('symbol')}"
    if event.get("method"):
        return f"{event.get('javaClassName')}.{event.get('method')}"
    return None


class OutputWriter:
    """Appends hook events to the ndjson output file and tracks event stats for display."""

    def __init__(self, output_path: Path):
        self.output_path = output_path
        self.event_count = 0
        self.last_event = "Waiting for events..."

    def truncate(self) -> None:
        with open(self.output_path, "w", encoding="utf-8"):
            pass

    def append(self, payload: list) -> None:
        with open(self.output_path, "a", encoding="utf-8") as f:
            json.dump(payload, f)
            f.write("\n")

    def record_event(self, event: dict) -> None:
        self.event_count += 1
        description = describe_event(event)
        if description:
            self.last_event = description
