"""Unit tests for frida message callbacks."""

import json
from unittest.mock import MagicMock

from frooky.runner.messages import create_message_handler, create_user_script_message_handler
from frooky.runner.output import OutputWriter


class TestCreateMessageHandler:
    def test_reports_agent_error_to_stderr(self, tmp_path, capsys):
        output = OutputWriter(tmp_path / "out.json")
        on_message = create_message_handler(output, print_events=False)

        on_message({"type": "error", "description": "boom"}, None)

        assert "boom" in capsys.readouterr().err
        assert not output.output_path.exists()

    def test_ignores_non_send_non_error_messages(self, tmp_path, capsys):
        output = OutputWriter(tmp_path / "out.json")
        on_message = create_message_handler(output, print_events=False)

        on_message({"type": "foo"}, None)

        assert "foo" in capsys.readouterr().out
        assert not output.output_path.exists()

    def test_non_list_payload_is_printed_raw(self, tmp_path, capsys):
        output = OutputWriter(tmp_path / "out.json")
        on_message = create_message_handler(output, print_events=False)

        on_message({"type": "send", "payload": "not a list"}, None)

        assert "not a list" in capsys.readouterr().out
        assert output.event_count == 0
        assert not output.output_path.exists()

    def test_writes_list_payload_and_updates_status_from_native_symbol(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        on_message = create_message_handler(output, print_events=False)
        payload = [{"module": "libc.so", "symbol": "strcpy"}, {"module": "libc.so", "symbol": "memcpy"}]

        on_message({"type": "send", "payload": payload}, None)

        assert output.event_count == 2
        assert output.last_event == "libc.so: memcpy"
        lines = output.output_path.read_text(encoding="utf-8").splitlines()
        assert json.loads(lines[0]) == payload

    def test_writes_list_payload_and_updates_status_from_java_method(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        on_message = create_message_handler(output, print_events=False)
        payload = [{"javaClassName": "com.example.Foo", "method": "bar"}]

        on_message({"type": "send", "payload": payload}, None)

        assert output.event_count == 1
        assert output.last_event == "com.example.Foo.bar"

    def test_calls_on_event_once_per_event(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        on_event = MagicMock()
        on_message = create_message_handler(output, print_events=False, on_event=on_event)
        payload = [{"symbol": "a"}, {"symbol": "b"}]

        on_message({"type": "send", "payload": payload}, None)

        assert on_event.call_count == 2

    def test_print_events_invokes_pretty_printer(self, tmp_path, monkeypatch):
        pp_mock = MagicMock()
        monkeypatch.setattr("frooky.runner.messages.pp_hook_event", pp_mock)
        output = OutputWriter(tmp_path / "out.json")
        on_message = create_message_handler(output, print_events=True)
        payload = [{"module": "libc.so", "symbol": "strcpy"}]

        on_message({"type": "send", "payload": payload}, None)

        pp_mock.assert_called_once_with(payload[0])


class TestCreateUserScriptMessageHandler:
    def test_prints_send_payload(self, capsys):
        on_message = create_user_script_message_handler("script.js")

        on_message({"type": "send", "payload": "hello"}, None)

        assert "[script.js] hello" in capsys.readouterr().out

    def test_prints_error_to_stderr(self, capsys):
        on_message = create_user_script_message_handler("script.js")

        on_message({"type": "error", "stack": "boom"}, None)

        assert "[script.js] boom" in capsys.readouterr().err

    def test_prints_other_message_types_raw(self, capsys):
        on_message = create_user_script_message_handler("script.js")

        on_message({"type": "foo"}, None)

        assert "[script.js]" in capsys.readouterr().out
