"""Unit tests for OutputWriter."""

import json

from frooky.runner.output import OutputWriter, describe_event


class TestDescribeEvent:
    def test_native_symbol(self):
        assert describe_event({"module": "libc.so", "symbol": "strcpy"}) == "libc.so: strcpy"

    def test_java_method(self):
        assert describe_event({"javaClassName": "com.example.Foo", "method": "bar"}) == "com.example.Foo.bar"

    def test_neither_returns_none(self):
        assert describe_event({}) is None


class TestOutputWriter:
    def test_truncate_creates_empty_file(self, tmp_path):
        output_path = tmp_path / "out.json"
        output_path.write_text("stale content")
        writer = OutputWriter(output_path)

        writer.truncate()

        assert output_path.read_text(encoding="utf-8") == ""

    def test_append_writes_ndjson_line(self, tmp_path):
        writer = OutputWriter(tmp_path / "out.json")
        payload = [{"module": "libc.so", "symbol": "strcpy"}]

        writer.append(payload)

        lines = writer.output_path.read_text(encoding="utf-8").splitlines()
        assert json.loads(lines[0]) == payload

    def test_append_is_additive(self, tmp_path):
        writer = OutputWriter(tmp_path / "out.json")

        writer.append([{"a": 1}])
        writer.append([{"b": 2}])

        lines = writer.output_path.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 2

    def test_record_event_updates_count_and_last_event(self, tmp_path):
        writer = OutputWriter(tmp_path / "out.json")

        writer.record_event({"module": "libc.so", "symbol": "strcpy"})
        writer.record_event({"javaClassName": "com.example.Foo", "method": "bar"})

        assert writer.event_count == 2
        assert writer.last_event == "com.example.Foo.bar"

    def test_record_event_without_description_keeps_previous_last_event(self, tmp_path):
        writer = OutputWriter(tmp_path / "out.json")
        writer.record_event({"module": "libc.so", "symbol": "strcpy"})

        writer.record_event({})

        assert writer.event_count == 2
        assert writer.last_event == "libc.so: strcpy"
