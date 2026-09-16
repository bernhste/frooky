"""Unit tests for the pure formatting/decoding logic in pp_hook_event."""

from frooky.pp_hook_event import _format_signature, _is_decoded_value, _unwrap, pp_hook_event


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
