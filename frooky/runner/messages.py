from __future__ import annotations

from typing import Callable, Optional

from .feed import Feed
from .output import OutputWriter


def create_message_handler(
    output: OutputWriter,
    feed: Feed,
    print_events: bool,
    on_event: Optional[Callable[[], None]] = None,
    on_progress: Optional[Callable[[dict], None]] = None,
):
    """Build the frooky agent's message callback: writes hook/log events to the output file
    and optionally prints them to the feed, calling on_event after each event in a batch.
    Hook resolving progress reports ({"frooky": "progress", "hooked": n, "pending": n}) go to on_progress."""

    def on_message(message, data):
        msg_type = message.get("type")

        if msg_type == "error":
            feed.log("error", f"Agent error: {message.get('stack') or message.get('description') or message}")
            return

        if msg_type != "send":
            feed.log("warn", f"Unexpected agent message: {message}")
            return

        payload = message.get("payload")

        if isinstance(payload, dict) and payload.get("frooky") == "progress":
            if on_progress:
                on_progress(payload)
            return

        # The agent always batches hook/log events as a JSON array (see eventSender.ts).
        if not isinstance(payload, list):
            feed.log("warn", f"Unexpected agent message: {payload}")
            return

        output.append(payload)

        for event in payload:
            output.record_event(event)
            if on_event:
                on_event()
            if print_events:
                feed.event(event)

    return on_message


def create_log_handler(feed: Feed, source: Optional[str] = None):
    """Build a Frida log handler that prints a script's console.log()/warn()/error() output to the feed."""

    def on_log(level: str, text: str) -> None:
        feed.log(level, text, source)

    return on_log


def create_user_script_message_handler(script_name: str, feed: Feed):
    """Build a message handler that prints a user script's send() output and errors to the feed."""

    def on_message(message, data):
        if message.get("type") == "send":
            feed.log("info", str(message.get("payload")), script_name)
        elif message.get("type") == "error":
            feed.log("error", str(message.get("stack", message.get("description"))), script_name)
        else:
            feed.log("info", str(message), script_name)

    return on_message
