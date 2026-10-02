from __future__ import annotations

import json
from pathlib import Path
from typing import Optional, TextIO


def describe_event(event: dict) -> Optional[str]:
    """Build a short human-readable label for a hook event, for the live status line."""
    if event.get("symbol"):
        return f"{event.get('module')}: {event.get('symbol')}"
    if event.get("offset"):
        return f"{event.get('module')}+{event.get('offset')}"
    if event.get("method"):
        return f"{event.get('javaClassName')}.{event.get('method')}"
    return None


class OutputWriter:
    """Appends hook events to the ndjson output file and tracks event stats for display."""

    def __init__(self, output_path: Path):
        self.output_path = output_path
        self.event_count = 0
        self.last_event = "Waiting for events..."
        self._file: Optional[TextIO] = None

    def open(self) -> None:
        if self._file is None:
            self._file = open(self.output_path, "a", encoding="utf-8")

    def close(self) -> None:
        if self._file is not None:
            self._file.close()
            self._file = None

    def __enter__(self) -> OutputWriter:
        self.open()
        return self

    def __exit__(self, *args) -> None:
        self.close()

    def truncate(self) -> None:
        was_open = self._file is not None
        self.close()
        with open(self.output_path, "w", encoding="utf-8"):
            pass
        if was_open:
            self.open()

    def append(self, payload: str | list[dict] | dict) -> None:
        if isinstance(payload, str):
            text = payload if payload.endswith("\n") else payload + "\n"
        elif isinstance(payload, list):
            text = "".join(json.dumps(event) + "\n" for event in payload)
        else:
            text = json.dumps(payload) + "\n"

        if self._file is not None:
            self._file.write(text)
            self._file.flush()
        else:
            with open(self.output_path, "a", encoding="utf-8") as f:
                f.write(text)

    def record_event(self, event: dict) -> None:
        self.event_count += 1
        description = describe_event(event)
        if description:
            self.last_event = description

    def record_events(self, events: list[dict]) -> None:
        self.event_count += len(events)
        for event in reversed(events):
            description = describe_event(event)
            if description:
                self.last_event = description
                break

    def record_events_raw(self, lines: list[str]) -> None:
        self.event_count += len(lines)
        for line in reversed(lines):
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            description = describe_event(event)
            if description:
                self.last_event = description
                break
