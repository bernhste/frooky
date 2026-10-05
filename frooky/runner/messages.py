from __future__ import annotations

import json
from typing import Callable, Optional

from .feed import Feed
from .output import OutputWriter


def create_message_handler(
    output: OutputWriter,
    feed: Feed,
    print_events: Callable[[], bool],
    on_event: Optional[Callable[[], None]] = None,
    on_progress: Optional[Callable[[dict], None]] = None,
    on_crash: Optional[Callable[[dict], None]] = None,
    on_batch: Optional[Callable[[], None]] = None,
):
    """Build the frooky agent's message callback: writes hook/log events to the output file
    and prints them to the feed while print_events() returns True, calling on_event after each event in a batch (or on_batch once per batch).
    Hook resolving progress reports ({"frooky": "progress", "hooked": n, "resolving": n, "waiting": n, "notFound": n}) go to on_progress,
    crash reports ({"frooky": "crash", "type": ..., "address": ..., "backtrace": [...], "nativeHooks": [...]}) to on_crash.
    The output of user scripts in the agent's script ({"frooky": "userLog" | "userSend", "script": name, ...}) goes to the feed."""

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

        if isinstance(payload, dict) and payload.get("frooky") == "crash":
            if on_crash:
                on_crash(payload)
            return

        # console output and send() messages of a user script (-l) that runs in the agent's script
        if isinstance(payload, dict) and payload.get("frooky") == "userLog":
            feed.log(payload.get("level", "info"), str(payload.get("text", "")), payload.get("script"))
            return

        if isinstance(payload, dict) and payload.get("frooky") == "userSend":
            feed.log("info", str(payload.get("payload")), payload.get("script"))
            return

        if isinstance(payload, str) and payload.lstrip().startswith("{"):
            lines = [line for line in payload.splitlines() if line]
            if not lines:
                return

            output.append(payload)
            output.record_events_raw(lines)

            if on_event:
                for _ in lines:
                    on_event()
            if on_batch:
                on_batch()

            if print_events():
                for line in lines:
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    feed.event(event)
            return

        if isinstance(payload, list):
            output.append(payload)
            output.record_events(payload)

            if on_event:
                for _ in payload:
                    on_event()
            if on_batch:
                on_batch()

            if print_events():
                for event in payload:
                    feed.event(event)
            return

        feed.log("warn", f"Unexpected agent message: {payload}")

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
