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
            hookCollections:
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
                "javaClass": MASTG_CLASS,
                "method": method,
                "argsIn": [{"type": arg_type, "value": value}],
                "returnValue": {"type": arg_type, "value": value},
            }
            assert count_matched_events(expected) == 1, f"{method} did not fire exactly once with the expected value."

    def test_long_is_decoded_as_a_decimal_string(self, run_frooky, count_matched_events):
        """`long` exceeds JS's 53-bit safe integer range, so PrimitiveDecoder renders it as a string."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - receiveLong
            """)

        run_frooky(hook_file, TARGET_APP)

        expected = {
            "javaClass": MASTG_CLASS,
            "method": "receiveLong",
            "argsIn": [{"type": "long", "value": "9223372036854775807"}],
        }
        assert count_matched_events(expected) == 1

    def test_short_form_with_decoder_settings_tuple(self, run_frooky, find_matched_events):
        """`[<method name>, {<decoder settings>}]` tuple: override decoderSettings without the expanded form."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - [receiveByteArray, {{decoder: string}}]
            """)

        run_frooky(hook_file, TARGET_APP)

        events = find_matched_events({"javaClass": MASTG_CLASS, "method": "receiveByteArray"})
        assert len(events) == 1
        event = events[0]
        # the "string" decoder applies to argsIn AND the return value here, since the tuple form
        # merges its decoderSettings into every param/returns of this hook.
        assert event["argsIn"][0]["type"] == "[B"
        assert isinstance(event["argsIn"][0]["value"], str)
        # receiveByteArray returns the same array unchanged, so both should decode identically.
        assert event["returnValue"]["value"] == event["argsIn"][0]["value"]

    def test_expanded_form_with_named_parameter(self, run_frooky, count_matched_events):
        """Expanded form + named parameter declaration: argsIn carries the declared param name."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - method: receiveString
                    overloads:
                      - params:
                          - [java.lang.String, receivedString]
            """)

        run_frooky(hook_file, TARGET_APP)

        expected = {
            "javaClass": MASTG_CLASS,
            "method": "receiveString",
            "argsIn": [{"type": "java.lang.String", "name": "receivedString", "value": "Welcome the first OWASP MASCon 📱❤️"}],
        }
        assert count_matched_events(expected) == 1

    def test_array_types_decode_to_plain_lists(self, run_frooky, count_matched_events):
        """Primitive and reference array types (see the Type Descriptors table) decode to plain lists."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
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
            expected = {"javaClass": MASTG_CLASS, "method": method, "argsIn": [{"type": arg_type, "value": value}]}
            assert count_matched_events(expected) == 1, f"{method} did not decode as expected."

        # reference array element type descriptors are less certain to pin down exactly (see the
        # Type Descriptors table), so only the decoded (already-unwrapped) values are checked here.
        expected_string_array = {"javaClass": MASTG_CLASS, "method": "receiveStringArray", "argsIn": [{"value": ["a", "b", "c"]}]}
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
            hookCollections:
              - javaClass: {MASTG_CLASS}
                hooks:
            """)
            + hooks_yaml
            + "\n"
        )

        run_frooky(hook_file, TARGET_APP)

        for method in methods:
            assert count_matched_events({"javaClass": MASTG_CLASS, "method": method}) == 1, f"{method} did not fire exactly once."

    def test_max_items_cuts_java_strings(self, run_frooky, find_matched_events):
        """`maxItems` cuts a java.lang.String after that many characters and appends `...` (see decoders.md)."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - method: receiveString
                    overloads:
                      - params:
                          - [java.lang.String, receivedString, {{maxItems: 7}}]
            """)

        run_frooky(hook_file, TARGET_APP)

        events = find_matched_events({"javaClass": MASTG_CLASS, "method": "receiveString"})
        assert len(events) == 1
        assert events[0]["argsIn"] == [{"type": "java.lang.String", "name": "receivedString", "value": "Welcome..."}]

    def test_decode_limit_truncates_collections(self, run_frooky, find_matched_events):
        """`maxItems` caps how many elements of a List/Collection get decoded (see decoders.md)."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                decoderSettings:
                  maxItems: 2
                hooks:
                  - receiveList
            """)

        run_frooky(hook_file, TARGET_APP)

        events = find_matched_events({"javaClass": MASTG_CLASS, "method": "receiveList"})
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

    def test_bitmask_with_fields_of_hooked_class(self, run_frooky, find_matched_events):
        """`decoder: bitmask` with `config.fields` resolves an int bitmask to the hooked class's Intent.FLAG_* names."""
        hook_file = textwrap.dedent("""\
            hookCollections:
              - javaClass: android.content.Intent
                hooks:
                  - method: setFlags
                    overloads:
                      - params:
                          - [int, flags, {decoder: bitmask, decoderOptions: { fields: "FLAG_*"}}]
            """)

        run_frooky(hook_file, TARGET_APP)

        # setFlags is a framework method: the app's own process could in principle call it more
        # than once, so look for our specific flag combination among however many events fired,
        # rather than assuming there's exactly one.
        events = find_matched_events({"javaClass": "android.content.Intent", "method": "setFlags"})
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
        assert matching[0]["type"] == "int"

    def test_hashcode_return_type_decoder(self, run_frooky, find_matched_events):
        """Java return type decoder: `returns: {decoder: hashCode}` renders `<class>@<hashCode>`."""
        hook_file = textwrap.dedent("""\
            hookCollections:
              - javaClass: android.security.keystore.KeyGenParameterSpec$Builder
                hooks:
                  - method: build
                    overloads:
                      - params: []
                        returns: {decoder: hashCode}
            """)

        run_frooky(hook_file, TARGET_APP)

        events = find_matched_events({"javaClass": "android.security.keystore.KeyGenParameterSpec$Builder", "method": "build"})
        assert len(events) >= 1
        assert all(re.match(r"^android\.security\.keystore\.KeyGenParameterSpec@[0-9a-f]+$", e["returnValue"]["value"]) for e in events)

    def test_hashcode_decoder_matches_event_hashcode(self, run_frooky, find_matched_events):
        """`decoder: hashCode` on a builder setter that returns `this` shows the `hashCode` of the event's instance."""
        hook_file = textwrap.dedent("""\
            hookCollections:
              - javaClass: android.security.keystore.KeyGenParameterSpec$Builder
                hooks:
                  - method: setKeySize
                    overloads:
                      - params: [[int, keySize]]
                        returns: {decoder: hashCode}
            """)

        run_frooky(hook_file, TARGET_APP)

        events = find_matched_events({"javaClass": "android.security.keystore.KeyGenParameterSpec$Builder", "method": "setKeySize"})
        assert len(events) >= 1
        for event in events:
            assert event["returnValue"]["value"] == f"android.security.keystore.KeyGenParameterSpec$Builder@{event['hashCode']}"

    def test_string_decoder_on_static_method_return_value(self, run_frooky, count_matched_events, find_matched_events):
        """`decoder: string` on a reference return type calls toString(); also verifies a static methodType."""
        hook_file = textwrap.dedent("""\
            hookCollections:
              - javaClass: java.security.KeyPairGenerator
                hooks:
                  - method: getInstance
                    overloads:
                      - params:
                          - [java.lang.String, algorithm]
                          - [java.lang.String, provider]
                        returns: {decoder: string}
            """)

        run_frooky(hook_file, TARGET_APP)

        # KeyPairGenerator.getInstance(String, String) is a static JDK method.
        assert (
            count_matched_events(
                {
                    "javaClass": "java.security.KeyPairGenerator",
                    "method": "getInstance",
                    "methodType": "static",
                }
            )
            >= 1
        )

        events = find_matched_events({"javaClass": "java.security.KeyPairGenerator", "method": "getInstance"})
        assert len(events) >= 1
        assert all(isinstance(e["returnValue"]["value"], str) for e in events)

    # Stack traces (see additional-features.md#stack-traces) are opt-in via `javaStackTrace` and
    # `nativeStackTrace`. A Java hook has no CPU context, so it only ever captures platform (Java) frames.

    def _receive_string_events(self, run_frooky, find_matched_events, hook_settings, expect_events=True):
        hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                hookSettings: {hook_settings}
                hooks:
                  - receiveString
            """)
        run_frooky(hook_file, TARGET_APP, expect_events=expect_events)
        return find_matched_events({"javaClass": MASTG_CLASS, "method": "receiveString"})

    def test_no_stack_trace_by_default(self, run_frooky, find_matched_events):
        """Without `javaStackTrace`/`nativeStackTrace`, no frames are captured."""
        events = self._receive_string_events(run_frooky, find_matched_events, "{}")

        assert len(events) == 1
        assert events[0]["stackTrace"] == {"javaStackTrace": [], "nativeStackTrace": []}

    def test_java_stack_trace_is_capped_by_max_stack_frames(self, run_frooky, find_matched_events):
        """`javaStackTrace` captures the Java frames, innermost (the hooked method) first, up to `maxStackFrames`."""
        events = self._receive_string_events(run_frooky, find_matched_events, "{javaStackTrace: true, maxStackFrames: 3}")

        assert len(events) == 1
        java_frames = events[0]["stackTrace"]["javaStackTrace"]
        assert 0 < len(java_frames) <= 3
        assert java_frames[0].startswith(f"{MASTG_CLASS}.receiveString ")
        assert events[0]["stackTrace"]["nativeStackTrace"] == []

    def test_native_stack_trace_is_empty_for_java_hooks(self, run_frooky, find_matched_events):
        """`nativeStackTrace` needs the CPU context of a native hook, so a Java hook captures no native frames."""
        events = self._receive_string_events(run_frooky, find_matched_events, "{nativeStackTrace: true}")

        assert len(events) == 1
        assert events[0]["stackTrace"] == {"javaStackTrace": [], "nativeStackTrace": []}

    def test_caller_filter_keeps_event_when_a_caller_matches(self, run_frooky, find_matched_events):
        """`callerFilter` keeps the call if a method on the Java stack matches. It needs no stack trace, so the
        event has none."""
        events = self._receive_string_events(run_frooky, find_matched_events, "{callerFilter: ['^org\\.owasp\\.mastestapp\\.']}")

        assert len(events) == 1
        assert events[0]["stackTrace"] == {"javaStackTrace": [], "nativeStackTrace": []}

    def test_caller_filter_keeps_the_requested_stack_trace(self, run_frooky, find_matched_events):
        """A kept event has the stack trace `javaStackTrace` asks for, whatever frames the filter matched."""
        events = self._receive_string_events(run_frooky, find_matched_events, "{javaStackTrace: true, maxStackFrames: 2, callerFilter: ['^org\\.owasp\\.mastestapp\\.']}")

        assert len(events) == 1
        assert len(events[0]["stackTrace"]["javaStackTrace"]) == 2

    def test_caller_filter_drops_event_when_no_caller_matches(self, run_frooky, find_matched_events):
        """If no method on the Java stack matches any pattern, the whole event is dropped."""
        events = self._receive_string_events(run_frooky, find_matched_events, "{callerFilter: ['^this\\.matches\\.nothing']}", expect_events=False)

        assert events == []

    def test_caller_filter_does_not_match_the_hooked_method(self, run_frooky, find_matched_events):
        """The hooked method is on top of the Java stack, but it isn't its own caller."""
        events = self._receive_string_events(run_frooky, find_matched_events, "{callerFilter: ['^org\\.owasp\\.mastestapp\\.MastgTest\\.receiveString$']}", expect_events=False)

        assert events == []

    def test_arg_filter_only_captures_matching_values(self, run_frooky, count_matched_events):
        """`argFilter` (see decoders.md) only captures the event if a decoded value matches."""
        matching_hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - method: receiveInt
                    overloads:
                      - params:
                          - [int, arg, {{argFilter: ['^2147483647$']}}]
            """)
        run_frooky(matching_hook_file, TARGET_APP)
        assert count_matched_events({"javaClass": MASTG_CLASS, "method": "receiveInt"}) == 1

    def test_arg_filter_excludes_non_matching_values(self, run_frooky, count_matched_events):
        non_matching_hook_file = textwrap.dedent(f"""\
            hookCollections:
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
        assert count_matched_events({"javaClass": MASTG_CLASS, "method": "receiveInt"}) == 0

    def test_arg_filter_numeric_comparison(self, run_frooky, count_matched_events):
        """Numeric comparisons in `argFilter` filter values by relational operator."""
        matching_hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - method: receiveInt
                    overloads:
                      - params:
                          - [int, arg, {{argFilter: ['> 1000']}}]
            """)
        run_frooky(matching_hook_file, TARGET_APP)
        assert count_matched_events({"javaClass": MASTG_CLASS, "method": "receiveInt"}) == 1

        non_matching_hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - method: receiveInt
                    overloads:
                      - params:
                          - [int, arg, {{argFilter: ['<= 1024']}}]
            """)
        run_frooky(non_matching_hook_file, TARGET_APP, expect_events=False)
        assert count_matched_events({"javaClass": MASTG_CLASS, "method": "receiveInt"}) == 0

    def test_same_method_hooked_twice_records_one_event_per_declaration(self, run_frooky, find_matched_events):
        """Multiple hooks (see additional-features.md): two declarations of the same method each record their own
        event per call, decoded with their own params. `hashCode` shows both events are about the same instance, the
        MastgTest object that receiveInt is called on as well."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
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
                "javaClass": MASTG_CLASS,
                "method": "receiveString",
                "methodType": "instance",
                "argsIn": [{"type": "java.lang.String", "name": name, "value": "Welcome the first OWASP MASCon 📱❤️"}],
            }
            matched = find_matched_events(expected)
            assert len(matched) == 1, f"the '{name}' declaration did not fire exactly once."
            events += matched
        events += find_matched_events({"javaClass": MASTG_CLASS, "method": "receiveInt"})

        assert len(events) == 3
        hash_codes = {event["hashCode"] for event in events}
        assert len(hash_codes) == 1, f"expected the same instance in every event, got {hash_codes}"
        assert re.fullmatch(r"[0-9a-f]{1,8}", hash_codes.pop())

    def test_identical_declarations_record_one_event(self, run_frooky, count_matched_events):
        """An identical declaration repeated in one hook file is hooked once."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - receiveInt
              - javaClass: {MASTG_CLASS}
                hooks:
                  - receiveInt
            """)

        run_frooky(hook_file, TARGET_APP)

        assert count_matched_events({"javaClass": MASTG_CLASS, "method": "receiveInt"}) == 1

    def test_arg_filter_of_one_declaration_does_not_affect_another(self, run_frooky, count_matched_events):
        """Each hook on the same method applies its own filters."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
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
            return f"hookCollections:\n  - javaClass: {MASTG_CLASS}\n    hooks:\n{hooks}"

        def recorded_by(frooky):
            events = frooky.click_start_and_collect({"javaClass": MASTG_CLASS, "method": "receiveString"})
            return sorted(event["argsIn"][0]["name"] for event in events)

        frooky = run_frooky_watch(hook_file("A", "B", "C"), TARGET_APP)
        assert recorded_by(frooky) == ["A", "B", "C"]

        frooky.update_hook_file(hook_file("A", "C"))
        assert recorded_by(frooky) == ["A", "C"]

        frooky.update_hook_file(hook_file("C"))
        assert recorded_by(frooky) == ["C"]

        frooky.update_hook_file(hook_file("A", "B", "C"))
        assert recorded_by(frooky) == ["A", "B", "C"]

    @pytest.mark.parametrize("decoder", ["constants", "bitmask"])
    def test_constants_decoders_keep_the_default_decoding_of_arrays_and_objects(self, run_frooky, find_matched_events, decoder):
        """`decoder: constants` and `decoder: bitmask` only decode primitives. An array, a list or a bundle is decoded
        as without the decoder, and the app and the events of the other hooks are unaffected."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                decoderSettings:
                  decoder: {decoder}
                hooks:
                  - receiveBooleanArray
                  - receiveByteArray
                  - receiveCharArray
                  - receiveStringArray
                  - receiveList
                  - receiveBundle
                  - receiveMode
              - javaClass: {MASTG_CLASS}
                hooks:
                  - trackEvent
            """)

        run_frooky(hook_file, TARGET_APP)

        def argument(method):
            (event,) = find_matched_events({"javaClass": MASTG_CLASS, "method": method})
            return event["argsIn"][0]["value"]

        assert argument("receiveBooleanArray") == [True, False]
        assert argument("receiveByteArray") == [1, 2, 3]
        assert argument("receiveCharArray") == ["x", "y", "z"]
        assert argument("receiveStringArray") == ["a", "b", "c"]
        assert [element["value"] for element in argument("receiveList")["value"]] == ["a", "b", "c"]
        assert {extra["name"] for extra in argument("receiveBundle")["value"]} == {"user", "age", "roles"}
        # MODE_DECRYPT = 2, a constant of the hooked class
        assert argument("receiveMode") == ("MODE_DECRYPT" if decoder == "constants" else ["MODE_DECRYPT"])
        # called last, after every value above was decoded and sent
        assert [event["argsIn"][0]["value"] for event in find_matched_events({"method": "trackEvent"})] == ["button_click", "sdk_flush"]

    def test_getters_decoder_decodes_the_getter_values_with_their_default_decoders(self, run_frooky, find_matched_events):
        """`decoder: getters` on an enum calls getDeclaringClass(), whose Class is decoded with its toString(), not
        through its own getters. The events after it are recorded."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - [receiveEnum, {{decoder: getters}}]
                  - [receiveLevel, {{decoder: getters}}]
                  - receiveNestedList
                  - trackEvent
            """)

        run_frooky(hook_file, TARGET_APP)

        def declaring_class(method):
            (event,) = find_matched_events({"javaClass": MASTG_CLASS, "method": method})
            (getter,) = event["argsIn"][0]["value"]
            assert getter["name"] == "declaringClass"
            return getter["value"]["value"]

        assert declaring_class("receiveEnum") == f"class {MASTG_CLASS}$Direction"
        assert declaring_class("receiveLevel") == "class org.owasp.mastestapp.Level"
        assert len(find_matched_events({"method": "receiveNestedList"})) == 1
        assert len(find_matched_events({"method": "trackEvent"})) == 2

    def test_getters_decoder_on_every_method_of_a_class(self, run_frooky, find_matched_events):
        """`decoder: getters` for a whole collection: every call is recorded, whatever type it passes."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                decoderSettings:
                  decoder: getters
                hooks:
                  - receive*
              - javaClass: {MASTG_CLASS}
                hooks:
                  - trackEvent
            """)

        run_frooky(hook_file, TARGET_APP)

        methods = {event["method"] for event in find_matched_events({"javaClass": MASTG_CLASS})}
        assert {"receiveString", "receiveIntArray", "receiveEnum", "receiveBundle", "receiveIntent", "receiveCipher", "receiveCertificate"} <= methods
        assert len(find_matched_events({"method": "trackEvent"})) == 2

    def test_collection_with_an_invalid_class_name_is_skipped(self, run_frooky_spawn, find_matched_events):
        """A `javaClass` that is no class name (empty, with a trailing dot, a JVM descriptor) is skipped when frooky
        spawns the app: the app starts, and the other hook collections are hooked."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: ""
                hooks: [receiveInt]
              - javaClass: {MASTG_CLASS}.
                hooks: [receiveInt]
              - javaClass: "Lorg/owasp/mastestapp/MastgTest;"
                hooks: [receiveInt]
              - javaClass: org/owasp/mastestapp/MastgTest
                hooks: [receiveInt]
              - javaClass: org.owasp.mastestapp.MainActivity
                hooks:
                  - method: onCreate
                    overloads:
                      - params:
                          - [android.os.Bundle, savedInstanceState]
            """)

        run_frooky_spawn(hook_file, TARGET_APP)

        events = find_matched_events({"type": "hook-java"})
        assert [(event["javaClass"], event["method"]) for event in events] == [("org.owasp.mastestapp.MainActivity", "onCreate")]

    def test_parameter_named_off_is_a_name_not_a_boolean(self, run_frooky, find_matched_events):
        """`off`, `on`, `yes` and `no` are names in a hook file, e.g. of the `off` and `len` parameters of a write()."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                hooks:
                  - method: sendPacket
                    overloads:
                      - params:
                          - ["[B", b, {{decoder: string, offset: off, length: len}}]
                          - [int, off]
                          - [int, len]
            """)

        run_frooky(hook_file, TARGET_APP)

        (event,) = find_matched_events({"javaClass": MASTG_CLASS, "method": "sendPacket"})
        assert [(arg["name"], arg["value"]) for arg in event["argsIn"]] == [("b", "hello frooky"), ("off", 7), ("len", 12)]

    def test_values_of_the_wrong_type_are_rejected_where_they_are_set(self, run_frooky, find_matched_events):
        """A boolean must be `true` or `false`, a count a whole number, a type a Java type descriptor and a filter
        a comparison or a regular expression. frooky skips the collection or hook with such a value, and hooks
        the others."""
        hook_file = textwrap.dedent(f"""\
            hookCollections:
              - javaClass: {MASTG_CLASS}
                hookSettings: {{javaStackTrace: yes}}
                hooks: [receiveString]
              - javaClass: {MASTG_CLASS}
                hookSettings: {{maxStackFrames: 2.5}}
                hooks: [receiveBoolean]
              - javaClass: {MASTG_CLASS}
                decoderSettings: {{maxItems: 1.5}}
                hooks: [receiveByte]
              - javaClass: {MASTG_CLASS}
                hooks:
                  - method: receiveByteArray
                    overloads:
                      - params: ["byte[]"]
                  - method: receiveShort
                    overloads:
                      - params: [[short, "$ret"]]
                  - method: receiveLong
                    overloads:
                      - params: [[long, value, {{argFilter: ["= 5"]}}]]
                  - method: receiveChar
                    overloads:
                      - params: [[char, value, {{argFilter: ["(?i)a"]}}]]
                  - method: receiveIntArray
                    overloads:
                      - params: [["[I", values, {{length: "2"}}]]
                  - receiveInt
            """)

        run_frooky(hook_file, TARGET_APP)

        assert {event["method"] for event in find_matched_events({"javaClass": MASTG_CLASS})} == {"receiveInt"}
