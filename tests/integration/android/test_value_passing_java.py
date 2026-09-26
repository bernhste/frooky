"""Integration tests for Java/Kotlin hooking against the value-passing-java target app.

The app's `MastgTest.mastgTest()` (triggered by clicking "Start") calls each `receiveXxx` method
exactly once with a fixed, known argument (see tests/target-apps/android/value-passing-java/MastgTest.kt),
so every assertion below is checked against a literal value from that source file.

Hook files are declared here as real YAML text (not Python dicts serialized to JSON), so these
tests exercise frooky's actual yaml.safe_load parsing path end to end.

These tests exercise the Java hook-file features documented in docs/java-hook-declaration.md,
docs/parameter-declaration.md, docs/decoders.md and docs/additional-features.md.
"""

import re
import textwrap

import pytest

TARGET_APP = "value-passing-java"
MASTG_CLASS = "org.owasp.mastestapp.MastgTest"


@pytest.mark.parametrize("platform", ["android"], indirect=True)
class TestValuePassingJava:
    """Tests for Java/Kotlin method hooking on Android."""

    def test_short_form_hooks_primitive_and_string_arguments(self, run_frooky, count_matched_events):
        """Basic usage: short-form `hooks: [<method name>]` with unnamed reflected parameters."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - receiveString
                  - receiveBoolean
                  - receiveByte
                  - receiveShort
                  - receiveInt
                  - receiveDouble
            """)

        run_frooky(hook_file, TARGET_APP)

        # short-form hooks resolve params via reflection, so argsIn entries have no "name" key.
        cases = [
            ("receiveString", "java.lang.String", "Welcome the first OWASP MASCon 📱❤️"),
            ("receiveBoolean", "boolean", True),
            ("receiveByte", "byte", 127),
            ("receiveShort", "short", 32767),
            ("receiveInt", "int", 2147483647),
            ("receiveDouble", "double", 3.141592653589793),
        ]
        for method, arg_type, value in cases:
            expected = {
                "type": "hook-java",
                "javaClassName": MASTG_CLASS,
                "method": method,
                "argsIn": [{"type": arg_type, "value": value}],
                "returnValue": {"type": arg_type, "value": value},
            }
            assert count_matched_events(expected) == 1, f"{method} did not fire exactly once with the expected value."

    def test_long_is_decoded_as_a_decimal_string(self, run_frooky, count_matched_events):
        """`long` exceeds JS's 53-bit safe integer range, so PrimitiveDecoder renders it as a string."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - receiveLong
            """)

        run_frooky(hook_file, TARGET_APP)

        expected = {
            "javaClassName": MASTG_CLASS,
            "method": "receiveLong",
            "argsIn": [{"type": "long", "value": "9223372036854775807"}],
        }
        assert count_matched_events(expected) == 1

    def test_short_form_with_decoder_settings_tuple(self, run_frooky, find_matched_events):
        """`[<method name>, {<decoder settings>}]` tuple: override decoderSettings without the expanded form."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - [receiveByteArray, {{decoder: string}}]
            """)

        run_frooky(hook_file, TARGET_APP)

        events = find_matched_events({"javaClassName": MASTG_CLASS, "method": "receiveByteArray"})
        assert len(events) == 1
        event = events[0]
        # the "string" decoder applies to argsIn AND the return value here, since the tuple form
        # merges its decoderSettings into every param/retType of this hook.
        assert event["argsIn"][0]["type"] == "[B"
        assert isinstance(event["argsIn"][0]["value"], str)
        # receiveByteArray returns the same array unchanged, so both should decode identically.
        assert event["returnValue"]["value"] == event["argsIn"][0]["value"]

    def test_expanded_form_with_named_parameter(self, run_frooky, count_matched_events):
        """Expanded form + named parameter declaration: argsIn carries the declared param name."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - method: receiveString
                    overloads:
                      - params:
                          - [java.lang.String, receivedString]
            """)

        run_frooky(hook_file, TARGET_APP)

        expected = {
            "javaClassName": MASTG_CLASS,
            "method": "receiveString",
            "argsIn": [{"type": "java.lang.String", "name": "receivedString", "value": "Welcome the first OWASP MASCon 📱❤️"}],
        }
        assert count_matched_events(expected) == 1

    def test_array_types_decode_to_plain_lists(self, run_frooky, count_matched_events):
        """Primitive and reference array types (see the Type Descriptors table) decode to plain lists."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - receiveByteArray
                  - receiveIntArray
                  - receiveBooleanArray
                  - receiveStringArray
            """)

        run_frooky(hook_file, TARGET_APP)

        cases = [
            ("receiveByteArray", "[B", [1, 2, 3]),
            ("receiveIntArray", "[I", [1, 2, 3]),
            ("receiveBooleanArray", "[Z", [True, False]),
        ]
        for method, arg_type, value in cases:
            expected = {"javaClassName": MASTG_CLASS, "method": method, "argsIn": [{"type": arg_type, "value": value}]}
            assert count_matched_events(expected) == 1, f"{method} did not decode as expected."

        # reference array element type descriptors are less certain to pin down exactly (see the
        # Type Descriptors table), so only the decoded (already-unwrapped) values are checked here.
        expected_string_array = {"javaClassName": MASTG_CLASS, "method": "receiveStringArray", "argsIn": [{"value": ["a", "b", "c"]}]}
        assert count_matched_events(expected_string_array) == 1

    def test_collection_and_reference_types_fire(self, run_frooky, count_matched_events):
        """Reference/collection types (BigInteger, BigDecimal, List, Map, Set, enums, nested arrays) all resolve."""
        methods = [
            "receiveBigInteger",
            "receiveBigDecimal",
            "receiveMap",
            "receiveSet",
            "receiveEnum",
            "receiveNestedObjectArray",
            "receiveNestedPrimitivesArray",
        ]
        hooks_yaml = "\n".join(f"      - {method}" for method in methods)
        hook_file = (
            textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hooks:
            """)
            + hooks_yaml
            + "\n"
        )

        run_frooky(hook_file, TARGET_APP)

        for method in methods:
            assert count_matched_events({"javaClassName": MASTG_CLASS, "method": method}) == 1, f"{method} did not fire exactly once."

    def test_decode_limit_truncates_collections(self, run_frooky, find_matched_events):
        """`decodeLimit` caps how many elements of a List/Collection get decoded (see decoders.md)."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                decoderSettings:
                  decodeLimit: 2
                hooks:
                  - receiveList
            """)

        run_frooky(hook_file, TARGET_APP)

        events = find_matched_events({"javaClassName": MASTG_CLASS, "method": "receiveList"})
        assert len(events) == 1
        # receiveList's param has no explicit type declared (short-form hook), so it goes through
        # ReferenceTypeDecoder, which wraps the resolved element decoder's own {type, value}
        # envelope (for the runtime List implementation) as its "value" - one level deeper than a
        # custom/array decoder's output. See decodedValue.ts / pp_hook_event.py's own _unwrap().
        decoded_list = events[0]["argsIn"][0]["value"]["value"]
        # listOf("a", "b", "c") capped at 2 elements, plus a truncation marker.
        assert len(decoded_list) == 3
        assert [item["value"] for item in decoded_list[:2]] == ["a", "b"]
        assert decoded_list[2] == {"type": "java.lang.String", "value": "[truncated at 2]"}

    def test_intent_flag_decoder(self, run_frooky, find_matched_events):
        """`decoder: intentFlag` resolves an int bitmask to the matching Intent.FLAG_* constant names."""
        hook_file = textwrap.dedent("""\
            hookCollection:
              - javaClass: android.content.Intent
                hooks:
                  - method: setFlags
                    overloads:
                      - params:
                          - [int, flags, {decoder: intentFlag}]
            """)

        run_frooky(hook_file, TARGET_APP)

        # setFlags is a framework method: the app's own process could in principle call it more
        # than once, so look for our specific flag combination among however many events fired,
        # rather than assuming there's exactly one.
        events = find_matched_events({"javaClassName": "android.content.Intent", "method": "setFlags"})
        assert len(events) >= 1
        expected_flags = {
            "FLAG_GRANT_READ_URI_PERMISSION",
            "FLAG_GRANT_WRITE_URI_PERMISSION",
            "FLAG_GRANT_PERSISTABLE_URI_PERMISSION",
            "FLAG_GRANT_PREFIX_URI_PERMISSION",
            "FLAG_ACTIVITY_NEW_TASK",
            "FLAG_ACTIVITY_CLEAR_TASK",
        }
        matching = [e["argsIn"][0] for e in events if set(e["argsIn"][0].get("value", [])) == expected_flags]
        assert len(matching) == 1
        assert matching[0]["type"] == "android.content.IntentFlag"

    def test_hashcode_return_type_decoder(self, run_frooky, find_matched_events):
        """Java return type decoder: `retType: {decoder: hashCode}` renders `<class>@<hashCode>`."""
        hook_file = textwrap.dedent("""\
            hookCollection:
              - javaClass: android.security.keystore.KeyGenParameterSpec$Builder
                hooks:
                  - method: build
                    overloads:
                      - params: []
                        retType: {decoder: hashCode}
            """)

        run_frooky(hook_file, TARGET_APP)

        events = find_matched_events({"javaClassName": "android.security.keystore.KeyGenParameterSpec$Builder", "method": "build"})
        assert len(events) >= 1
        assert all(re.match(r"^android\.security\.keystore\.KeyGenParameterSpec@[0-9a-f]+$", e["returnValue"]["value"]) for e in events)

    def test_string_decoder_on_static_method_return_value(self, run_frooky, count_matched_events, find_matched_events):
        """`decoder: string` on a reference return type calls toString(); also verifies a static fieldType."""
        hook_file = textwrap.dedent("""\
            hookCollection:
              - javaClass: java.security.KeyPairGenerator
                hooks:
                  - method: getInstance
                    overloads:
                      - params:
                          - [java.lang.String, algorithm]
                          - [java.lang.String, provider]
                        retType: {decoder: string}
            """)

        run_frooky(hook_file, TARGET_APP)

        # KeyPairGenerator.getInstance(String, String) is a static JDK method.
        assert (
            count_matched_events(
                {
                    "javaClassName": "java.security.KeyPairGenerator",
                    "method": "getInstance",
                    "fieldType": {"fieldType": "static"},
                }
            )
            >= 1
        )

        events = find_matched_events({"javaClassName": "java.security.KeyPairGenerator", "method": "getInstance"})
        assert len(events) >= 1
        assert all(isinstance(e["returnValue"]["value"], str) for e in events)

    def test_stack_trace_limit(self, run_frooky, find_matched_events):
        """`stackTraceLimit` (see additional-features.md) caps how many stack frames are captured."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hookSettings:
                  stackTraceLimit: 3
                hooks:
                  - receiveString
            """)

        run_frooky(hook_file, TARGET_APP)

        events = find_matched_events({"javaClassName": MASTG_CLASS, "method": "receiveString"})
        assert len(events) == 1
        assert 0 < len(events[0]["stackTrace"]) <= 3

    def test_stack_trace_filter_keeps_event_when_a_frame_matches(self, run_frooky, count_matched_events):
        """`stackTraceFilter` is an event-level gate: if any captured frame matches, the whole
        (unfiltered) stack trace is kept - individual non-matching frames are not trimmed."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hookSettings:
                  stackTraceLimit: 5
                  stackTraceFilter: ['^org\\.owasp\\.mastestapp']
                hooks:
                  - receiveString
            """)

        run_frooky(hook_file, TARGET_APP)

        assert count_matched_events({"javaClassName": MASTG_CLASS, "method": "receiveString"}) == 1

    def test_stack_trace_filter_drops_event_when_no_frame_matches(self, run_frooky, count_matched_events):
        """If no captured frame matches any pattern, the whole event is dropped."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hookSettings:
                  stackTraceLimit: 5
                  stackTraceFilter: ['^this\\.matches\\.nothing']
                hooks:
                  - receiveString
            """)

        run_frooky(hook_file, TARGET_APP, expect_events=False)

        assert count_matched_events({"javaClassName": MASTG_CLASS, "method": "receiveString"}) == 0

    def test_arg_filter_only_captures_matching_values(self, run_frooky, count_matched_events):
        """`argFilter` (see decoders.md) only captures the event if a decoded value matches."""
        matching_hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - method: receiveInt
                    overloads:
                      - params:
                          - [int, arg, {{argFilter: ['^2147483647$']}}]
            """)
        run_frooky(matching_hook_file, TARGET_APP)
        assert count_matched_events({"javaClassName": MASTG_CLASS, "method": "receiveInt"}) == 1

    def test_arg_filter_excludes_non_matching_values(self, run_frooky, count_matched_events):
        non_matching_hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - method: receiveInt
                    overloads:
                      - params:
                          - [int, arg, {{argFilter: ['^0$']}}]
            """)
        # this hook is the only one declared, and argFilter excludes it entirely (a
        # FilterMismatchError drops the event before it's ever logged), so no events at all
        # are expected to be written.
        run_frooky(non_matching_hook_file, TARGET_APP, expect_events=False)
        assert count_matched_events({"javaClassName": MASTG_CLASS, "method": "receiveInt"}) == 0
