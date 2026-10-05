"""Unit tests for frida message callbacks."""

import json
from unittest.mock import MagicMock

from frooky.runner.messages import create_log_handler, create_message_handler, create_user_script_message_handler
from frooky.runner.output import OutputWriter


class TestCreateMessageHandler:
    def test_logs_agent_error(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        feed = MagicMock()
        on_message = create_message_handler(output, feed, print_events=lambda: False)

        on_message({"type": "error", "description": "boom"}, None)

        feed.log.assert_called_once_with("error", "Agent error: boom")
        assert not output.output_path.exists()

    def test_logs_non_send_non_error_messages(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        feed = MagicMock()
        on_message = create_message_handler(output, feed, print_events=lambda: False)

        on_message({"type": "foo"}, None)

        level, message = feed.log.call_args.args
        assert level == "warn"
        assert "foo" in message
        assert not output.output_path.exists()

    def test_non_list_payload_is_logged(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        feed = MagicMock()
        on_message = create_message_handler(output, feed, print_events=lambda: False)

        on_message({"type": "send", "payload": "not a list"}, None)

        assert "not a list" in feed.log.call_args.args[1]
        assert output.event_count == 0
        assert not output.output_path.exists()

    def test_writes_list_payload_and_updates_status_from_native_symbol(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        on_message = create_message_handler(output, MagicMock(), print_events=lambda: False)
        payload = [{"module": "libc.so", "symbol": "strcpy"}, {"module": "libc.so", "symbol": "memcpy"}]

        on_message({"type": "send", "payload": payload}, None)

        assert output.event_count == 2
        assert output.last_event == "libc.so: memcpy"
        lines = output.output_path.read_text(encoding="utf-8").splitlines()
        assert json.loads(lines[0]) == payload[0]
        assert json.loads(lines[1]) == payload[1]

    def test_writes_ndjson_string_payload_and_updates_status(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        on_message = create_message_handler(output, MagicMock(), print_events=lambda: False)
        payload = '{"module": "libc.so", "symbol": "strcpy"}\n{"module": "libc.so", "symbol": "memcpy"}\n'

        on_message({"type": "send", "payload": payload}, None)

        assert output.event_count == 2
        assert output.last_event == "libc.so: memcpy"
        lines = output.output_path.read_text(encoding="utf-8").splitlines()
        assert json.loads(lines[0]) == {"module": "libc.so", "symbol": "strcpy"}
        assert json.loads(lines[1]) == {"module": "libc.so", "symbol": "memcpy"}

    def test_writes_list_payload_and_updates_status_from_java_method(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        on_message = create_message_handler(output, MagicMock(), print_events=lambda: False)
        payload = [{"javaClassName": "com.example.Foo", "method": "bar"}]

        on_message({"type": "send", "payload": payload}, None)

        assert output.event_count == 1
        assert output.last_event == "com.example.Foo.bar"

    def test_calls_on_event_once_per_event(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        on_event = MagicMock()
        on_message = create_message_handler(output, MagicMock(), print_events=lambda: False, on_event=on_event)
        payload = [{"symbol": "a"}, {"symbol": "b"}]

        on_message({"type": "send", "payload": payload}, None)

        assert on_event.call_count == 2

    def test_calls_on_batch_once_per_batch(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        on_batch = MagicMock()
        on_message = create_message_handler(output, MagicMock(), print_events=lambda: False, on_batch=on_batch)
        payload = [{"symbol": "a"}, {"symbol": "b"}, {"symbol": "c"}]

        on_message({"type": "send", "payload": payload}, None)

        assert on_batch.call_count == 1

    def test_calls_both_on_batch_and_on_event(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        on_event = MagicMock()
        on_batch = MagicMock()
        on_message = create_message_handler(output, MagicMock(), print_events=lambda: False, on_event=on_event, on_batch=on_batch)
        payload = [{"symbol": "a"}, {"symbol": "b"}]

        on_message({"type": "send", "payload": payload}, None)

        assert on_batch.call_count == 1
        assert on_event.call_count == 2

    def test_print_events_prints_each_event_to_the_feed(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        feed = MagicMock()
        on_message = create_message_handler(output, feed, print_events=lambda: True)
        payload = [{"module": "libc.so", "symbol": "strcpy"}]

        on_message({"type": "send", "payload": payload}, None)

        feed.event.assert_called_once_with(payload[0])

    def test_events_are_not_printed_without_print_events(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        feed = MagicMock()
        on_message = create_message_handler(output, feed, print_events=lambda: False)

        on_message({"type": "send", "payload": [{"module": "libc.so", "symbol": "strcpy"}]}, None)

        feed.event.assert_not_called()

    def test_progress_report_goes_to_on_progress_and_not_to_the_output(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        feed = MagicMock()
        on_progress = MagicMock()
        on_message = create_message_handler(output, feed, print_events=lambda: True, on_progress=on_progress)
        progress = {"frooky": "progress", "hooked": 38, "resolving": 4}

        on_message({"type": "send", "payload": progress}, None)

        on_progress.assert_called_once_with(progress)
        feed.log.assert_not_called()
        assert not output.output_path.exists()

    def test_crash_report_goes_to_on_crash_and_not_to_the_output(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        feed = MagicMock()
        on_crash = MagicMock()
        on_message = create_message_handler(output, feed, print_events=lambda: True, on_crash=on_crash)
        crash = {"frooky": "crash", "type": "abort", "address": "libc.so!abort+0xc0", "backtrace": [], "nativeHooks": []}

        on_message({"type": "send", "payload": crash}, None)

        on_crash.assert_called_once_with(crash)
        feed.log.assert_not_called()
        assert not output.output_path.exists()

    def test_user_script_output_goes_to_the_feed_tagged_with_the_script_and_not_to_the_output(self, tmp_path):
        output = OutputWriter(tmp_path / "out.json")
        feed = MagicMock()
        on_message = create_message_handler(output, feed, print_events=lambda: True)

        on_message({"type": "send", "payload": {"frooky": "userLog", "script": "unlock.js", "level": "warning", "text": "careful"}}, None)
        on_message({"type": "send", "payload": {"frooky": "userSend", "script": "unlock.js", "payload": '{"a": 1}'}}, None)

        assert feed.log.call_args_list == [
            (("warning", "careful", "unlock.js"),),
            (("info", '{"a": 1}', "unlock.js"),),
        ]
        assert not output.output_path.exists()


class TestCreateLogHandler:
    def test_forwards_level_text_and_source(self):
        feed = MagicMock()

        create_log_handler(feed, "script.js")("warning", "careful")

        feed.log.assert_called_once_with("warning", "careful", "script.js")


class TestCreateUserScriptMessageHandler:
    def test_logs_send_payload(self):
        feed = MagicMock()
        on_message = create_user_script_message_handler("script.js", feed)

        on_message({"type": "send", "payload": "hello"}, None)

        feed.log.assert_called_once_with("info", "hello", "script.js")

    def test_logs_error(self):
        feed = MagicMock()
        on_message = create_user_script_message_handler("script.js", feed)

        on_message({"type": "error", "stack": "boom"}, None)

        feed.log.assert_called_once_with("error", "boom", "script.js")

    def test_logs_other_message_types_raw(self):
        feed = MagicMock()
        on_message = create_user_script_message_handler("script.js", feed)

        on_message({"type": "foo"}, None)

        assert "foo" in feed.log.call_args.args[1]
