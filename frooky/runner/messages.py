from __future__ import annotations

import sys
from typing import Callable, Optional

from ..pp_hook_event import pp_hook_event
from .output import OutputWriter


def create_message_handler(output: OutputWriter, print_events: bool, on_event: Optional[Callable[[], None]] = None):
    """Build the frooky agent's message callback: writes hook/log events to the output file
    and optionally pretty-prints them, calling on_event after each event in a batch."""

    def on_message(message, data):
        msg_type = message.get("type")

        if msg_type == "error":
            print(f"Agent error: {message.get('stack') or message.get('description') or message}", file=sys.stderr)
            return

        if msg_type != "send":
            print("MSG", message)
            return

        payload = message.get("payload")

        # The agent always batches hook/log events as a JSON array (see eventSender.ts).
        if not isinstance(payload, list):
            print("MSG", payload)
            return

        output.append(payload)

        for event in payload:
            output.record_event(event)
            if on_event:
                on_event()
            if print_events:
                pp_hook_event(event)

    return on_message


def create_user_script_message_handler(script_name: str):
    """Build a message handler that prints a user script's send()/console.log output and errors."""

    def on_message(message, data):
        if message.get("type") == "send":
            print(f"[{script_name}] {message.get('payload')}")
        elif message.get("type") == "error":
            print(f"[{script_name}] {message.get('stack', message.get('description'))}", file=sys.stderr)
        else:
            print(f"[{script_name}] {message}")

    return on_message
