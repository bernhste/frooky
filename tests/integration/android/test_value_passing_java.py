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

    def test_max_items_cuts_java_strings(self, run_frooky, find_matched_events):
        """`maxItems` cuts a java.lang.String after that many characters and appends `...` (see decoders.md)."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - method: receiveString
                    overloads:
                      - params:
                          - [java.lang.String, receivedString, {{maxItems: 7}}]
            """)

        run_frooky(hook_file, TARGET_APP)

        events = find_matched_events({"javaClassName": MASTG_CLASS, "method": "receiveString"})
        assert len(events) == 1
        assert events[0]["argsIn"] == [{"type": "java.lang.String", "name": "receivedString", "value": "Welcome..."}]

    def test_decode_limit_truncates_collections(self, run_frooky, find_matched_events):
        """`maxItems` caps how many elements of a List/Collection get decoded (see decoders.md)."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                decoderSettings:
                  maxItems: 2
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

    # Stack traces (see additional-features.md#stack-traces) are opt-in via `platformStackTrace` and
    # `nativeStackTrace`. A Java hook has no CPU context, so it only ever captures platform (Java) frames.

    def _receive_string_events(self, run_frooky, find_matched_events, hook_settings, expect_events=True):
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hookSettings: {hook_settings}
                hooks:
                  - receiveString
            """)
        run_frooky(hook_file, TARGET_APP, expect_events=expect_events)
        return find_matched_events({"javaClassName": MASTG_CLASS, "method": "receiveString"})

    def test_no_stack_trace_by_default(self, run_frooky, find_matched_events):
        """Without `platformStackTrace`/`nativeStackTrace`, no frames are captured."""
        events = self._receive_string_events(run_frooky, find_matched_events, "{}")

        assert len(events) == 1
        assert events[0]["stackTrace"] == {"platformStackTrace": [], "nativeStackTrace": []}

    def test_platform_stack_trace_is_capped_by_max_stack_frames(self, run_frooky, find_matched_events):
        """`platformStackTrace` captures the Java frames, innermost (the hooked method) first, up to `maxStackFrames`."""
        events = self._receive_string_events(run_frooky, find_matched_events, "{platformStackTrace: true, maxStackFrames: 3}")

        assert len(events) == 1
        platform_frames = events[0]["stackTrace"]["platformStackTrace"]
        assert 0 < len(platform_frames) <= 3
        assert platform_frames[0].startswith(f"{MASTG_CLASS}.receiveString ")
        assert events[0]["stackTrace"]["nativeStackTrace"] == []

    def test_native_stack_trace_is_empty_for_java_hooks(self, run_frooky, find_matched_events):
        """`nativeStackTrace` needs the CPU context of a native hook, so a Java hook captures no native frames."""
        events = self._receive_string_events(run_frooky, find_matched_events, "{nativeStackTrace: true}")

        assert len(events) == 1
        assert events[0]["stackTrace"] == {"platformStackTrace": [], "nativeStackTrace": []}

    def test_stack_trace_filter_keeps_event_when_a_frame_matches(self, run_frooky, find_matched_events):
        """`stackTraceFilter` is an event-level gate: if any captured frame matches, the whole
        (unfiltered) stack trace is kept - individual non-matching frames are not trimmed."""
        events = self._receive_string_events(run_frooky, find_matched_events, "{platformStackTrace: true, maxStackFrames: 5, stackTraceFilter: ['^org\\.owasp\\.mastestapp']}")

        assert len(events) == 1
        platform_frames = events[0]["stackTrace"]["platformStackTrace"]
        assert 0 < len(platform_frames) <= 5
        assert any(frame.startswith("org.owasp.mastestapp") for frame in platform_frames)

    def test_stack_trace_filter_drops_event_when_no_frame_matches(self, run_frooky, find_matched_events):
        """If no captured frame matches any pattern, the whole event is dropped."""
        events = self._receive_string_events(
            run_frooky,
            find_matched_events,
            "{platformStackTrace: true, maxStackFrames: 5, stackTraceFilter: ['^this\\.matches\\.nothing']}",
            expect_events=False,
        )

        assert events == []

    def test_stack_trace_filter_only_searches_the_first_max_stack_frames(self, run_frooky, find_matched_events):
        """With `maxStackFrames: 1` only the hooked method's own frame is searched, so a pattern that only
        matches its callers drops the event."""
        events = self._receive_string_events(
            run_frooky,
            find_matched_events,
            "{platformStackTrace: true, maxStackFrames: 1, stackTraceFilter: ['^org\\.owasp\\.mastestapp\\.MainActivity']}",
            expect_events=False,
        )

        assert events == []

    def test_stack_trace_filter_drops_every_event_without_captured_frames(self, run_frooky, find_matched_events):
        """A `stackTraceFilter` only searches captured frames: with no stack trace enabled nothing can match."""
        events = self._receive_string_events(run_frooky, find_matched_events, "{stackTraceFilter: ['^org\\.owasp\\.mastestapp']}", expect_events=False)

        assert events == []

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

    def test_same_method_hooked_twice_records_one_event_per_declaration(self, run_frooky, find_matched_events):
        """Multiple hooks (see additional-features.md): two declarations of the same method each record their own
        event per call, decoded with their own params. `hashCode` shows both events are about the same instance, the
        MastgTest object that receiveInt is called on as well."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - method: receiveString
                    overloads:
                      - params:
                          - [java.lang.String, first]
                  - method: receiveString
                    overloads:
                      - params:
                          - [java.lang.String, second]
                  - receiveInt
            """)

        run_frooky(hook_file, TARGET_APP)

        events = []
        for name in ["first", "second"]:
            expected = {
                "javaClassName": MASTG_CLASS,
                "method": "receiveString",
                "fieldType": {"fieldType": "instance"},
                "argsIn": [{"type": "java.lang.String", "name": name, "value": "Welcome the first OWASP MASCon 📱❤️"}],
            }
            matched = find_matched_events(expected)
            assert len(matched) == 1, f"the '{name}' declaration did not fire exactly once."
            events += matched
        events += find_matched_events({"javaClassName": MASTG_CLASS, "method": "receiveInt"})

        assert len(events) == 3
        hash_codes = {event["hashCode"] for event in events}
        assert len(hash_codes) == 1, f"expected the same instance in every event, got {hash_codes}"
        assert re.fullmatch(r"[0-9a-f]{1,8}", hash_codes.pop())

    def test_identical_declarations_record_one_event(self, run_frooky, count_matched_events):
        """An identical declaration repeated in one hook file is hooked once."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - receiveInt
              - javaClass: {MASTG_CLASS}
                hooks:
                  - receiveInt
            """)

        run_frooky(hook_file, TARGET_APP)

        assert count_matched_events({"javaClassName": MASTG_CLASS, "method": "receiveInt"}) == 1

    def test_arg_filter_of_one_declaration_does_not_affect_another(self, run_frooky, count_matched_events):
        """Each hook on the same method applies its own filters."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - method: receiveInt
                    overloads:
                      - params:
                          - [int, filtered, {{argFilter: ['^0$']}}]
                  - method: receiveInt
                    overloads:
                      - params:
                          - [int, unfiltered]
            """)

        run_frooky(hook_file, TARGET_APP)

        assert count_matched_events({"method": "receiveInt", "argsIn": [{"name": "filtered"}]}) == 0
        assert count_matched_events({"method": "receiveInt", "argsIn": [{"name": "unfiltered", "value": 2147483647}]}) == 1

    def test_removing_one_of_several_hooks_keeps_the_others(self, run_frooky_watch):
        """Multiple hooks + `--watch`: removing a hook on a method from the hook file while frooky runs only
        stops that hook's events, and adding it back hooks it again."""

        def hook_file(*names):
            hooks = "".join(f"      - method: receiveString\n        overloads:\n          - params:\n              - [java.lang.String, {name}]\n" for name in names)
            return f"hookCollection:\n  - javaClass: {MASTG_CLASS}\n    hooks:\n{hooks}"

        def recorded_by(frooky):
            events = frooky.click_start_and_collect({"javaClassName": MASTG_CLASS, "method": "receiveString"})
            return sorted(event["argsIn"][0]["name"] for event in events)

        frooky = run_frooky_watch(hook_file("A", "B", "C"), TARGET_APP)
        assert recorded_by(frooky) == ["A", "B", "C"]

        frooky.update_hook_file(hook_file("A", "C"))
        assert recorded_by(frooky) == ["A", "C"]

        frooky.update_hook_file(hook_file("C"))
        assert recorded_by(frooky) == ["C"]

        frooky.update_hook_file(hook_file("A", "B", "C"))
        assert recorded_by(frooky) == ["A", "B", "C"]
