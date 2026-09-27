"""Unit tests for the pure formatting/decoding logic in pp_hook_event."""

import re

from frooky.pp_hook_event import _format_signature, _is_decoded_value, _unwrap, format_hook_event, pp_hook_event


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

        out = capsys.readouterr().out
        assert "java (method)" in out
        assert "2026-01-01T00:00:00Z" in out
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

        out = capsys.readouterr().out
        assert "native" in out
        assert "libc.so" in out
        assert "strcpy()" in out

    def test_return_value_with_data_is_printed(self, capsys):
        hook = {
            "type": "native-hook",
            "module": "libc.so",
            "symbol": "strcpy",
            "returnValue": {"type": "int", "value": {"type": "int", "value": 0}},
        }

        pp_hook_event(hook)

        out = capsys.readouterr().out
        assert "returns" in out
        assert "int" in out

    def test_hook_without_optional_fields_does_not_crash(self, capsys):
        hook = {"type": "native-hook", "module": "libc.so", "symbol": "strcpy"}

        pp_hook_event(hook)

        out = capsys.readouterr().out
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

        value_lines = lines[lines.index("│ arguments in") + 1 : -1]
        assert all(len(line) <= 79 for line in value_lines)
        assert value_lines[0].startswith("│   buf    void *  'a b")
        assert "".join(line[2:].strip() for line in value_lines) == "buf    void *  " + repr(value)

    def test_arguments_are_a_table_of_name_type_and_value(self):
        hook = {
            "type": "native-hook",
            "module": "libc.so",
            "symbol": "write",
            "argsIn": [
                {"type": "int", "name": "fd", "value": "74"},
                {"type": "const void *", "name": "buf", "value": "...."},
            ],
            "argsOut": [{"type": "const void *", "name": "buf", "value": "done"}],
            "returnValue": {"type": "ssize_t", "value": "4"},
        }

        lines = _plain(format_hook_event(hook))

        start = lines.index("│ arguments in")
        assert lines[start : start + 3] == [
            "│ arguments in",
            "│   fd     int           '74'",
            "│   buf    const void *  '....'",
        ]
        assert "│   buf    const void *  'done'" == lines[lines.index("│ arguments out") + 1]
        assert "│ returns  ssize_t       4" in lines

    def test_keeps_the_labelled_fields(self):
        hook = {"type": "native-hook", "timestamp": "t", "module": "libc.so", "symbol": "close", "argsIn": [{"type": "int", "name": "fd"}]}

        lines = _plain(format_hook_event(hook))

        assert lines[1:4] == ["│ time      :  t", "│ module    :  libc.so", "│ function  :  close(int fd)"]

    def test_values_move_below_a_row_whose_columns_are_too_wide(self):
        long_type = "java.security.spec.AlgorithmParameterSpec"
        hook = {"type": "java-hook", "javaClassName": "C", "method": "m", "argsIn": [{"type": long_type, "name": "p", "value": "v"}]}

        lines = _plain(format_hook_event(hook, width=60))

        row = lines.index(f"│   p      {long_type}")
        assert lines[row + 1] == "│     'v'"

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


class TestIntegerStrings:
    def _row(self, t, v):
        hook = {"type": "native-hook", "module": "m", "symbol": "f", "argsIn": [{"type": t, "name": "x", "value": v}]}
        return next(line for line in _plain(format_hook_event(hook)) if line.startswith("│   x"))

    def test_64_bit_integer_types_are_printed_without_quotes(self):
        for t in ("size_t", "ssize_t", "const size_t", "unsigned long", "off_t", "uint64_t", "long"):
            assert self._row(t, "524288").endswith(f"{t}  524288"), t

    def test_negative_values_are_printed_without_quotes(self):
        assert self._row("ssize_t", "-1").endswith("ssize_t  -1")

    def test_strings_of_other_types_keep_their_quotes(self):
        assert self._row("const char *", "524288").endswith("'524288'")

    def test_non_numeric_values_keep_their_quotes(self):
        assert self._row("size_t", "0x10").endswith("'0x10'")


def _plain(lines: list[str]) -> list[str]:
    return [re.sub(r"\033\[[0-9;]*m", "", line) for line in lines]
