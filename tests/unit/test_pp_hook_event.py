"""Unit tests for the pure formatting/decoding logic in pp_hook_event."""

import re
import time

from frooky.pp_hook_event import _format_signature, _is_decoded_value, _local_time, _unwrap, format_hook_event, pp_hook_event


class TestIsDecodedValue:
    def test_plain_envelope_is_decoded_value(self):
        assert _is_decoded_value({"type": "String", "value": "hi"}) is True

    def test_envelope_with_name_is_decoded_value(self):
        assert _is_decoded_value({"type": "String", "name": "x", "value": "hi"}) is True

    def test_dict_without_value_key_is_not(self):
        assert _is_decoded_value({"type": "String"}) is False

    def test_dict_with_extra_keys_is_not(self):
        assert _is_decoded_value({"type": "String", "value": "hi", "extra": 1}) is False

    def test_non_dict_is_not(self):
        assert _is_decoded_value("hi") is False
        assert _is_decoded_value(None) is False
        assert _is_decoded_value([1, 2]) is False


class TestUnwrap:
    def test_unwraps_scalar_envelope(self):
        assert _unwrap({"type": "String", "value": "hi"}) == "hi"

    def test_unwraps_nested_envelope(self):
        nested = {"type": "String", "value": {"type": "String", "value": "hi"}}
        assert _unwrap(nested) == "hi"

    def test_passes_through_plain_scalars(self):
        assert _unwrap("hi") == "hi"
        assert _unwrap(42) == 42
        assert _unwrap(None) is None

    def test_walks_plain_dict_fields_recursively(self):
        value = {"flags": {"type": "int", "value": 1}, "label": "plain"}
        assert _unwrap(value) == {"flags": 1, "label": "plain"}

    def test_list_of_unnamed_entries_stays_a_list(self):
        value = [{"type": "String", "value": "a"}, {"type": "String", "value": "b"}]
        assert _unwrap(value) == ["a", "b"]

    def test_list_of_uniquely_named_entries_becomes_a_dict(self):
        value = [
            {"type": "String", "name": "k1", "value": "v1"},
            {"type": "int", "name": "k2", "value": 2},
        ]
        assert _unwrap(value) == {"k1": "v1", "k2": 2}

    def test_list_with_duplicate_names_stays_a_list(self):
        value = [
            {"type": "String", "name": "k1", "value": "v1"},
            {"type": "String", "name": "k1", "value": "v2"},
        ]
        assert _unwrap(value) == ["v1", "v2"]

    def test_list_with_partial_names_stays_a_list(self):
        value = [
            {"type": "String", "name": "k1", "value": "v1"},
            {"type": "String", "value": "v2"},
        ]
        assert _unwrap(value) == ["v1", "v2"]


class TestFormatSignature:
    def test_no_args(self):
        assert _format_signature("bar", []) == "bar()"

    def test_named_args(self):
        args = [{"type": "int", "name": "x"}, {"type": "String", "name": "y"}]
        assert _format_signature("bar", args) == "bar(int x, String y)"

    def test_unnamed_arg_falls_back_to_type_only(self):
        args = [{"type": "String"}]
        assert _format_signature("bar", args) == "bar(String)"

    def test_missing_type_defaults_to_question_mark(self):
        args = [{"name": "x"}]
        assert _format_signature("bar", args) == "bar(? x)"


class TestPpHookEvent:
    def test_java_hook_prints_class_method_args_return_and_stack(self, capsys):
        hook = {
            "type": "java-hook",
            "timestamp": "2026-01-01T00:00:00Z",
            "javaClassName": "com.example.Foo",
            "method": "bar",
            "fieldType": {"fieldType": "method"},
            "argsIn": [{"type": "String", "name": "x", "value": {"type": "String", "value": "hi"}}],
            "returnValue": {"type": "void"},
            "stackTrace": ["frame1", "frame2"],
        }

        pp_hook_event(hook)

        out = "\n".join(_plain(capsys.readouterr().out.splitlines()))
        assert "java (method)" in out
        assert _local_time("2026-01-01T00:00:00Z") in out
        assert "com.example.Foo" in out
        assert "bar(String x)" in out
        assert "'hi'" in out
        assert "void" in out
        assert "frame1" in out
        assert "frame2" in out

    def test_java_hook_field_type_as_plain_string(self, capsys):
        hook = {
            "type": "java-hook",
            "javaClassName": "com.example.Foo",
            "method": "bar",
            "fieldType": "field",
        }

        pp_hook_event(hook)

        assert "java (field)" in capsys.readouterr().out

    def test_native_hook_prints_module_and_symbol(self, capsys):
        hook = {
            "type": "native-hook",
            "timestamp": "t",
            "module": "libc.so",
            "symbol": "strcpy",
            "argsIn": [],
        }

        pp_hook_event(hook)

        out = "\n".join(_plain(capsys.readouterr().out.splitlines()))
        assert "native" in out
        assert "libc.so" in out
        assert "strcpy()" in out

    def test_native_hook_by_module_offset_prints_the_offset(self, capsys):
        hook = {"type": "native-hook", "timestamp": "t", "module": "libfoo.so", "offset": "0x1a2b4", "argsIn": []}

        pp_hook_event(hook)

        out = "\n".join(_plain(capsys.readouterr().out.splitlines()))
        assert "libfoo.so" in out
        assert "0x1a2b4()" in out

    def test_return_value_with_data_is_printed(self, capsys):
        hook = {
            "type": "native-hook",
            "module": "libc.so",
            "symbol": "strcpy",
            "returnValue": {"type": "int", "value": {"type": "int", "value": 0}},
        }

        pp_hook_event(hook)

        out = "\n".join(_plain(capsys.readouterr().out.splitlines()))
        assert "returns" in out
        assert "int" in out

    def test_hook_without_optional_fields_does_not_crash(self, capsys):
        hook = {"type": "native-hook", "module": "libc.so", "symbol": "strcpy"}

        pp_hook_event(hook)

        out = "\n".join(_plain(capsys.readouterr().out.splitlines()))
        assert "libc.so" in out
        assert "strcpy()" in out

    def test_long_string_is_wrapped_as_a_single_repr(self):
        value = "a b\r" + "x" * 300
        hook = {
            "type": "native-hook",
            "module": "libc.so",
            "symbol": "read",
            "argsIn": [{"type": "void *", "name": "buf", "value": value}],
        }

        lines = _plain(format_hook_event(hook, width=80))

        value_lines = lines[lines.index("│     void * buf") + 1 : -1]
        assert all(len(line) <= 79 for line in value_lines)
        assert value_lines[0].startswith("│       'a b")
        assert "".join(line[2:].strip() for line in value_lines) == repr(value)

    def test_arguments_are_a_list_of_type_and_name_with_the_value_below(self):
        hook = {
            "type": "native-hook",
            "module": "libc.so",
            "symbol": "write",
            "argsIn": [
                {"type": "int", "value": "74"},
                {"type": "const void *", "name": "buf", "value": "...."},
            ],
            "argsOut": [{"type": "const void *", "name": "buf", "value": "done"}],
            "returnValue": {"type": "ssize_t", "value": "4"},
        }

        lines = _plain(format_hook_event(hook))

        start = lines.index("│ arguments in:")
        assert lines[start : start + 5] == [
            "│ arguments in:",
            "│     int",
            "│       '74'",
            "│     const void * buf",
            "│       '....'",
        ]
        out_start = lines.index("│ arguments out:")
        assert lines[out_start + 1 : out_start + 3] == ["│     const void * buf", "│       'done'"]
        ret_start = lines.index("│ returns:")
        assert lines[ret_start + 1 : ret_start + 3] == ["│     ssize_t", "│       4"]

    def test_void_return_has_no_value_line(self):
        hook = {"type": "java-hook", "javaClassName": "C", "method": "m", "returnValue": {"type": "void"}}

        lines = _plain(format_hook_event(hook))

        assert lines[lines.index("│ returns:") + 1 :] == ["│     void", lines[-1]]

    def test_labelled_fields_have_the_colon_after_the_key_and_aligned_values(self):
        hook = {
            "type": "native-hook",
            "timestamp": "t",
            "module": "libc.so",
            "symbol": "close",
            "argsIn": [{"type": "int", "name": "fd"}],
            "stackTrace": ["frame1", "frame2"],
        }

        lines = _plain(format_hook_event(hook))

        assert lines[1:4] == ["│ time:         t", "│ module:       libc.so", "│ function:     close(int fd)"]
        assert lines[-3:-1] == ["│ stack trace:  frame1", "│               frame2"]

    def test_values_start_at_the_same_column_regardless_of_type_length(self):
        long_type = "java.security.spec.AlgorithmParameterSpec"
        hook = {
            "type": "java-hook",
            "javaClassName": "C",
            "method": "m",
            "argsIn": [{"type": long_type, "name": "p", "value": {"a": 1, "b": 2}}, {"type": "int", "name": "n", "value": 3}],
        }

        lines = _plain(format_hook_event(hook, width=60))

        assert lines[lines.index(f"│     {long_type} p") + 1] == "│       {'a': 1, 'b': 2}"
        assert lines[lines.index("│     int n") + 1] == "│       3"

    def test_no_line_is_wider_than_the_box(self):
        hook = {
            "type": "java-hook",
            "javaClassName": "c" * 200,
            "method": "m",
            "argsIn": [{"type": "t" * 100, "name": "n" * 100, "value": {"k": "v" * 300}}],
            "stackTrace": ["f" * 300],
        }

        for line in _plain(format_hook_event(hook, width=60)):
            assert len(line) <= 60


class TestParamColors:
    _HOOK = {
        "type": "native-hook",
        "module": "libc.so",
        "symbol": "write",
        "argsIn": [
            {"type": "int", "value": 1},
            {"type": "const void *", "name": "buf", "value": "...."},
            {"type": "size_t", "name": "count", "value": "4"},
        ],
        "argsOut": [
            {"type": "const void *", "name": "buf", "value": "done"},
            {"type": "int", "name": "extra", "value": 2},
        ],
    }

    def test_each_parameter_in_the_signature_has_its_own_color(self):
        signature = next(line for line in format_hook_event(self._HOOK) if "function" in line)

        colors = [_color_of(signature, p) for p in ("int", "const void * buf", "size_t count")]
        assert None not in colors
        assert len(set(colors)) == 3

    def test_argument_rows_use_the_color_of_their_parameter(self):
        lines = format_hook_event(self._HOOK)
        signature = next(line for line in lines if "function" in line)
        rows = lines[_plain(lines).index("│ arguments in:") + 1 :]

        assert _color_of(rows[0], "int") == _color_of(signature, "int")
        assert _color_of(rows[2], "const void * buf") == _color_of(signature, "const void * buf")
        assert _color_of(rows[4], "size_t count") == _color_of(signature, "size_t count")

    def test_out_rows_match_their_in_row_by_name_and_others_get_a_new_color(self):
        lines = format_hook_event(self._HOOK)
        signature = next(line for line in lines if "function" in line)
        out_rows = lines[_plain(lines).index("│ arguments out:") + 1 :]

        assert _color_of(out_rows[0], "const void * buf") == _color_of(signature, "const void * buf")
        assert _color_of(out_rows[2], "int extra") not in {_color_of(signature, p) for p in ("int", "const void * buf", "size_t count")}

    def test_wrapped_signature_keeps_parameter_colors_across_lines(self):
        hook = {"type": "native-hook", "module": "m", "symbol": "f", "argsIn": [{"type": "t" * 30, "name": f"p{i}"} for i in range(4)]}

        lines = format_hook_event(hook, width=60)

        start = next(i for i, line in enumerate(lines) if "function" in line)
        continuation = lines[start + 1]
        assert continuation.count("\033[38;5;") >= 1
        assert all(len(line) <= 60 for line in _plain(lines))


class TestIntegerStrings:
    def _row(self, t, v):
        hook = {"type": "native-hook", "module": "m", "symbol": "f", "argsIn": [{"type": t, "name": "x", "value": v}]}
        lines = _plain(format_hook_event(hook))
        return lines[lines.index(f"│     {t} x") + 1]

    def test_64_bit_integer_types_are_printed_without_quotes(self):
        for t in ("size_t", "ssize_t", "const size_t", "unsigned long", "off_t", "uint64_t", "long"):
            assert self._row(t, "524288") == "│       524288", t

    def test_negative_values_are_printed_without_quotes(self):
        assert self._row("ssize_t", "-1") == "│       -1"

    def test_strings_of_other_types_keep_their_quotes(self):
        assert self._row("const char *", "524288").endswith("'524288'")

    def test_non_numeric_values_keep_their_quotes(self):
        assert self._row("size_t", "0x10").endswith("'0x10'")


def _color_of(line: str, text: str) -> str | None:
    """The ANSI color code directly in front of `text` in `line`, or None if `text` isn't colored."""
    match = re.search(r"(\033\[[0-9;]*m) *" + re.escape(text), line)
    return match.group(1) if match else None


def _plain(lines: list[str]) -> list[str]:
    return [re.sub(r"\033\[[0-9;]*m", "", line) for line in lines]


class TestLocalTime:
    def test_converts_the_utc_timestamp_to_local_time(self, monkeypatch):
        monkeypatch.setenv("TZ", "Europe/Zurich")
        time.tzset()
        try:
            assert _local_time("2026-09-27T07:49:16.405Z") == "2026-09-27 09:49:16.405"
        finally:
            monkeypatch.delenv("TZ")
            time.tzset()

    def test_keeps_anything_it_cannot_parse(self):
        assert _local_time("t") == "t"
        assert _local_time("2026-09-27T07:49:16") == "2026-09-27T07:49:16"
