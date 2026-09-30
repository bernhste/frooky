"""Integration tests for native (JNI/C) hooking against the value-passing-native target app.

The app's `MastgTest.mastgTest()` (triggered by clicking "Start") calls receiveFundamentalValueJNI(),
receiveFundamentalReferenceJNI() and receiveStringsJNI() exactly once, each of which calls its native
C functions exactly once with fixed, known arguments (see
tests/target-apps/android/value-passing-native/cpp/*.c), so every assertion below is checked against
a literal value from those source files.

Hook files are declared here as real YAML text (not Python dicts serialized to JSON), so these
tests exercise frooky's actual yaml.safe_load parsing path end to end.

These tests exercise the native hook-file features documented in docs/native-hook-declaration.md,
docs/parameter-declaration.md and docs/decoders.md.
"""

import re
import struct
import textwrap

import pytest

TARGET_APP = "value-passing-native"
MODULE_VALUE = "libreceiveFundamentalValue.so"
MODULE_REFERENCE = "libreceiveFundamentalReference.so"
MODULE_STRING = "libreceiveString.so"


def _as_int(value):
    """Word-sized/64-bit native ints decode as decimal strings on LP64 targets, plain numbers on ILP32."""
    return int(value)


def _address_hash_code(address: str) -> str:
    """frooky's native `hashCode`: the address hashed like Java's Long.hashCode(), as unsigned hex."""
    value = int(address, 16)
    return format(((value & 0xFFFFFFFF) ^ (value >> 32)) & 0xFFFFFFFF, "x")


def _round_trip_float32(value: float) -> float:
    """The exact float32 value the compiler rounds a Kotlin/C float literal to."""
    return struct.unpack("<f", struct.pack("<f", value))[0]


@pytest.mark.parametrize("platform", ["android"], indirect=True)
class TestValuePassingNative:
    """Tests for native C function hooking on Android."""

    def test_by_value_fundamental_types(self, run_frooky, count_matched_events):
        """Basic usage + named parameters: fundamental types passed by value (see Type Descriptors)."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_VALUE}
                hooks:
                  - symbol: receive_bool
                    retType: bool
                    params:
                      - [bool, minValue]
                      - [bool, maxValue]
                  # declared as "char" (by value): NativeValueDecoder treats it as a signed byte, not a C string.
                  - symbol: receive_char
                    retType: char
                    params:
                      - [char, minValue]
                      - [char, maxValue]
                  - symbol: receive_schar
                    retType: "signed char"
                    params:
                      - ["signed char", minValue]
                      - ["signed char", maxValue]
                  - symbol: receive_uchar
                    retType: "unsigned char"
                    params:
                      - ["unsigned char", minValue]
                      - ["unsigned char", maxValue]
                  - symbol: receive_short
                    retType: short
                    params:
                      - [short, minValue]
                      - [short, maxValue]
                  - symbol: receive_ushort
                    retType: "unsigned short"
                    params:
                      - ["unsigned short", minValue]
                      - ["unsigned short", maxValue]
                  - symbol: receive_int
                    retType: int
                    params:
                      - [int, minValue]
                      - [int, maxValue]
                  - symbol: receive_uint
                    retType: "unsigned int"
                    params:
                      - ["unsigned int", minValue]
                      - ["unsigned int", maxValue]
            """)

        run_frooky(hook_file, TARGET_APP)

        cases = [
            ("receive_bool", False, True),
            ("receive_char", ord("A"), ord("Z")),
            ("receive_schar", -128, 127),
            ("receive_uchar", 0, 255),
            ("receive_short", -32768, 32767),
            ("receive_ushort", 0, 65535),
            ("receive_int", -2147483648, 2147483647),
            ("receive_uint", 0, 4294967295),
        ]
        for symbol, min_value, max_value in cases:
            expected = {
                "type": "hook-native",
                "module": MODULE_VALUE,
                "symbol": symbol,
                "argsIn": [{"name": "minValue", "value": min_value}, {"name": "maxValue", "value": max_value}],
                "returnValue": {"value": min_value},
            }
            assert count_matched_events(expected) == 1, f"{symbol} did not decode as expected."

    def test_by_value_wide_and_floating_point_types(self, run_frooky, find_matched_events):
        """64-bit/word-sized ints may decode as decimal strings (precision-safe); floats round-trip via IEEE-754."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_VALUE}
                hooks:
                  - symbol: receive_long
                    retType: long
                    params:
                      - [long, minValue]
                      - [long, maxValue]
                  - symbol: receive_ulong
                    retType: "unsigned long"
                    params:
                      - ["unsigned long", minValue]
                      - ["unsigned long", maxValue]
                  - symbol: receive_llong
                    retType: "long long"
                    params:
                      - ["long long", minValue]
                      - ["long long", maxValue]
                  - symbol: receive_ullong
                    retType: "unsigned long long"
                    params:
                      - ["unsigned long long", minValue]
                      - ["unsigned long long", maxValue]
                  - symbol: receive_float
                    retType: float
                    params:
                      - [float, minValue]
                      - [float, maxValue]
                  - symbol: receive_double
                    retType: double
                    params:
                      - [double, minValue]
                      - [double, maxValue]
            """)

        run_frooky(hook_file, TARGET_APP)

        long_events = find_matched_events({"module": MODULE_VALUE, "symbol": "receive_long"})
        assert len(long_events) == 1
        assert _as_int(long_events[0]["argsIn"][0]["value"]) == -2147483648
        assert _as_int(long_events[0]["argsIn"][1]["value"]) == 2147483647

        ulong_events = find_matched_events({"module": MODULE_VALUE, "symbol": "receive_ulong"})
        assert len(ulong_events) == 1
        assert _as_int(ulong_events[0]["argsIn"][0]["value"]) == 0
        assert _as_int(ulong_events[0]["argsIn"][1]["value"]) == 4294967295

        llong_events = find_matched_events({"module": MODULE_VALUE, "symbol": "receive_llong"})
        assert len(llong_events) == 1
        assert _as_int(llong_events[0]["argsIn"][0]["value"]) == -9223372036854775807
        assert _as_int(llong_events[0]["argsIn"][1]["value"]) == 9223372036854775807

        ullong_events = find_matched_events({"module": MODULE_VALUE, "symbol": "receive_ullong"})
        assert len(ullong_events) == 1
        assert _as_int(ullong_events[0]["argsIn"][0]["value"]) == 0
        assert _as_int(ullong_events[0]["argsIn"][1]["value"]) == 18446744073709551615

        float_events = find_matched_events({"module": MODULE_VALUE, "symbol": "receive_float"})
        assert len(float_events) == 1
        assert float_events[0]["argsIn"][0]["value"] == _round_trip_float32(-3.4028235e38)
        assert float_events[0]["argsIn"][1]["value"] == _round_trip_float32(3.4028235e38)

        double_events = find_matched_events({"module": MODULE_VALUE, "symbol": "receive_double"})
        assert len(double_events) == 1
        assert double_events[0]["argsIn"][0]["value"] == -1.7976931348623157e308
        assert double_events[0]["argsIn"][1]["value"] == 1.7976931348623157e308

    def test_interleaved_int_and_float_arguments(self, run_frooky, find_matched_events):
        """int and float/double arguments live in entirely separate CPU register files, each with
        its own independent counter (see nativeFloatArgs.ts) - so a param's real register index
        isn't simply its position in the declared list once the two are interleaved. Every other
        test here only ever hooks an all-int or all-float signature, which can't tell a correct
        per-class index apart from a naively reused raw position; this one can."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_VALUE}
                hooks:
                  - symbol: receive_interleaved_types
                    retType: double
                    params:
                      - [int, intArg1]
                      - [double, doubleArg1]
                      - [int, intArg2]
                      - [float, floatArg1]
                      - [int, intArg3]
                      - [double, doubleArg2]
            """)

        run_frooky(hook_file, TARGET_APP)

        events = find_matched_events({"module": MODULE_VALUE, "symbol": "receive_interleaved_types"})
        assert len(events) == 1
        args_in = {arg["name"]: arg["value"] for arg in events[0]["argsIn"]}
        assert args_in["intArg1"] == 11
        assert args_in["doubleArg1"] == 2.5
        assert args_in["intArg2"] == 22
        assert args_in["floatArg1"] == _round_trip_float32(3.5)
        assert args_in["intArg3"] == 33
        assert args_in["doubleArg2"] == 4.5
        assert events[0]["returnValue"]["value"] == 2.5

    def test_more_int_arguments_than_fit_in_registers(self, run_frooky, find_matched_events):
        """Beyond the general-purpose argument registers available (6 on SysV x86-64, 8 on
        AAPCS64/arm64-v8a), further int arguments spill onto the stack. Frida's own args[]
        abstraction is expected to already handle that transparently (unlike float/double
        register-class handling, which frooky has to do itself - see nativeFloatArgs.ts); this
        confirms that's actually true rather than just assumed."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_VALUE}
                hooks:
                  - symbol: receive_many_ints
                    retType: int
                    params:
                      - [int, a]
                      - [int, b]
                      - [int, c]
                      - [int, d]
                      - [int, e]
                      - [int, f]
                      - [int, g]
                      - [int, h]
                      - [int, i]
                      - [int, j]
            """)

        run_frooky(hook_file, TARGET_APP)

        events = find_matched_events({"module": MODULE_VALUE, "symbol": "receive_many_ints"})
        assert len(events) == 1
        args_in = {arg["name"]: arg["value"] for arg in events[0]["argsIn"]}
        assert args_in == {"a": 1, "b": 2, "c": 3, "d": 4, "e": 5, "f": 6, "g": 7, "h": 8, "i": 9, "j": 10}
        assert events[0]["returnValue"]["value"] == 1

    def test_by_reference_fundamental_types(self, run_frooky, count_matched_events, find_matched_events):
        """Pointer params decode by dereferencing them; frooky's own declared type - not the real C
        prototype - drives which decoder runs, e.g. "int8 *"/"uint8 *" avoid the char/uchar
        pointer decoders' C-string guessing for lone byte pointers."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_REFERENCE}
                hooks:
                  - symbol: receive_bool_ref
                    params:
                      - ["bool *", minValue]
                      - ["bool *", maxValue]
                  # "char"/"signed char" pointers would try to decode as a NUL-terminated C
                  # string; "int8 *"/"uint8 *" get the plain single-byte numeric read instead.
                  - symbol: receive_char_ref
                    params:
                      - ["int8 *", minValue]
                      - ["int8 *", maxValue]
                  - symbol: receive_schar_ref
                    params:
                      - ["int8 *", minValue]
                      - ["int8 *", maxValue]
                  - symbol: receive_uchar_ref
                    params:
                      - ["uint8 *", minValue]
                      - ["uint8 *", maxValue]
                  - symbol: receive_short_ref
                    params:
                      - ["short *", minValue]
                      - ["short *", maxValue]
                  - symbol: receive_ushort_ref
                    params:
                      - ["unsigned short *", minValue]
                      - ["unsigned short *", maxValue]
                  - symbol: receive_int_ref
                    params:
                      - ["int *", minValue]
                      - ["int *", maxValue]
                  - symbol: receive_uint_ref
                    params:
                      - ["unsigned int *", minValue]
                      - ["unsigned int *", maxValue]
                  - symbol: receive_long_ref
                    params:
                      - ["long *", minValue]
                      - ["long *", maxValue]
                  - symbol: receive_ulong_ref
                    params:
                      - ["unsigned long *", minValue]
                      - ["unsigned long *", maxValue]
                  - symbol: receive_llong_ref
                    params:
                      - ["long long *", minValue]
                      - ["long long *", maxValue]
                  - symbol: receive_ullong_ref
                    params:
                      - ["unsigned long long *", minValue]
                      - ["unsigned long long *", maxValue]
                  - symbol: receive_float_ref
                    params:
                      - ["float *", minValue]
                      - ["float *", maxValue]
                  - symbol: receive_double_ref
                    params:
                      - ["double *", minValue]
                      - ["double *", maxValue]
            """)

        run_frooky(hook_file, TARGET_APP)

        exact_cases = [
            ("receive_bool_ref", False, True),
            ("receive_char_ref", ord("A"), ord("Z")),
            ("receive_schar_ref", -128, 127),
            ("receive_uchar_ref", 0, 255),
            ("receive_short_ref", -32768, 32767),
            ("receive_ushort_ref", 0, 65535),
            ("receive_int_ref", -2147483648, 2147483647),
            ("receive_uint_ref", 0, 4294967295),
            ("receive_double_ref", -1.7976931348623157e308, 1.7976931348623157e308),
        ]
        for symbol, min_value, max_value in exact_cases:
            expected = {
                "module": MODULE_REFERENCE,
                "symbol": symbol,
                "argsIn": [{"name": "minValue", "value": min_value}, {"name": "maxValue", "value": max_value}],
                # no retType declared for these hooks, so no returnValue field is present.
                "argsOut": [],
            }
            assert count_matched_events(expected) == 1, f"{symbol} did not decode as expected."

        float_min, float_max = _round_trip_float32(-3.4028235e38), _round_trip_float32(3.4028235e38)
        expected_float = {
            "module": MODULE_REFERENCE,
            "symbol": "receive_float_ref",
            "argsIn": [{"value": float_min}, {"value": float_max}],
        }
        assert count_matched_events(expected_float) == 1

        # word-sized/64-bit reference reads may come back as decimal strings on LP64 targets, so
        # these go through find_matched_events + _as_int rather than an exact literal-value match.
        word_sized_cases = [
            ("receive_long_ref", -2147483648, 2147483647),
            ("receive_ulong_ref", 0, 4294967295),
            ("receive_llong_ref", -9223372036854775807, 9223372036854775807),
            ("receive_ullong_ref", 0, 18446744073709551615),
        ]
        for symbol, min_value, max_value in word_sized_cases:
            events = find_matched_events({"module": MODULE_REFERENCE, "symbol": symbol})
            assert len(events) == 1, f"{symbol} did not fire exactly once."
            assert _as_int(events[0]["argsIn"][0]["value"]) == min_value, f"{symbol} minValue did not decode as expected."
            assert _as_int(events[0]["argsIn"][1]["value"]) == max_value, f"{symbol} maxValue did not decode as expected."

    def test_ldouble_ref_short_form_hook_without_decoding(self, run_frooky, count_matched_events):
        """`long double` has no frida/frooky type mapping either by value or by reference (see
        nativeFridaType.ts), so `receive_ldouble_ref` can only be hooked in short form."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_REFERENCE}
                hooks:
                  - receive_ldouble_ref
            """)

        run_frooky(hook_file, TARGET_APP)

        expected = {"module": MODULE_REFERENCE, "symbol": "receive_ldouble_ref", "argsIn": [], "argsOut": []}
        assert count_matched_events(expected) == 1

    def test_buffer_with_decoder_arg_and_direction_inout(self, run_frooky, find_matched_events):
        """`decoderArg` + `direction: inout` (see decoders.md): decode a length-bounded buffer before/after the call."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_REFERENCE}
                hooks:
                  - symbol: receive_byte_array
                    params:
                      - ["unsigned char *", data, {{direction: inout, decoderArg: length}}]
                      - [int, length]
            """)

        run_frooky(hook_file, TARGET_APP)

        events = find_matched_events({"module": MODULE_REFERENCE, "symbol": "receive_byte_array"})
        assert len(events) == 1
        event = events[0]
        # data = {0x48, 0x65, 0x6C, 0x6C, 0x6F} ("Hello"); the function XORs each byte with 0xFF in place.
        assert event["argsIn"][0]["value"] == "0x48656c6c6f"
        assert event["argsOut"][0]["value"] == "0xb79a939390"

    def test_null_terminated_buffer_with_direction_inout(self, run_frooky, count_matched_events):
        """Without `decoderArg`, a `char *`/`unsigned char *` decodes as a NUL-terminated C string."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_REFERENCE}
                hooks:
                  - symbol: reverse_byte_array
                    params:
                      - ["unsigned char *", data, {{direction: inout}}]
                      - [int, length]
            """)

        run_frooky(hook_file, TARGET_APP)

        expected = {
            "module": MODULE_REFERENCE,
            "symbol": "reverse_byte_array",
            "argsIn": [{"name": "data", "value": "Welcome OWASP MASCon"}, {"name": "length", "value": 20}],
            "argsOut": [{"name": "data", "value": "noCSAM PSAWO emocleW"}],
        }
        assert count_matched_events(expected) == 1

    def test_null_terminated_strings(self, run_frooky, count_matched_events):
        """Named native parameters + return type decoding for plain NUL-terminated C strings."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_STRING}
                hooks:
                  - symbol: receive_cstring
                    retType: "char *"
                    params:
                      - ["char *", s]
                  - symbol: receive_utf8
                    retType: "char *"
                    params:
                      - ["char *", s]
            """)

        run_frooky(hook_file, TARGET_APP)

        assert (
            count_matched_events(
                {
                    "module": MODULE_STRING,
                    "symbol": "receive_cstring",
                    "argsIn": [{"name": "s", "value": "Welcome the first OWASP MASCon, CString!"}],
                    "returnValue": {"value": "Welcome the first OWASP MASCon, CString!"},
                }
            )
            == 1
        )
        assert (
            count_matched_events(
                {
                    "module": MODULE_STRING,
                    "symbol": "receive_utf8",
                    "argsIn": [{"name": "s", "value": "Welcome the first OWASP MASCon 📱❤️"}],
                }
            )
            == 1
        )

    def test_short_form_hook_without_decoding(self, run_frooky, count_matched_events):
        """Short form (symbol only): the hook fires with no argument/return type decoding at all.

        `long double` also has no frida/frooky type mapping (see nativeFridaType.ts), so it can only
        be hooked this way - without declaring `params`/`retType`.
        """
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_VALUE}
                hooks:
                  - receive_ldouble
            """)

        run_frooky(hook_file, TARGET_APP)

        expected = {"module": MODULE_VALUE, "symbol": "receive_ldouble", "argsIn": [], "argsOut": []}
        assert count_matched_events(expected) == 1

    def test_short_form_with_decoder_settings_tuple(self, run_frooky, find_matched_events):
        """`[<symbol name>, {<decoder settings>}]` tuple: override decoderSettings without the expanded form."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_VALUE}
                hooks:
                  - [receive_int, {{hashCode: true}}]
            """)

        run_frooky(hook_file, TARGET_APP)

        # short form still means no params/retType, regardless of the decoderSettings override,
        # and the override itself is applied: hashCode adds a hash of the function's address to the event.
        events = find_matched_events({"module": MODULE_VALUE, "symbol": "receive_int", "argsIn": [], "argsOut": []})
        assert len(events) == 1
        assert events[0]["hashCode"] == _address_hash_code(events[0]["address"])

    def test_address_without_hash_code(self, run_frooky, find_matched_events):
        """Every native event carries the function's `address`; `hashCode` only with the `hashCode` setting."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_VALUE}
                hooks:
                  - receive_int
            """)

        run_frooky(hook_file, TARGET_APP)

        [event] = find_matched_events({"module": MODULE_VALUE, "symbol": "receive_int"})
        assert re.fullmatch(r"0x[0-9a-f]+", event["address"])
        assert "hashCode" not in event

    # Stack traces (see additional-features.md#hook-settings) are opt-in: `nativeStackTrace` captures the
    # C/C++ frames from the hook's CPU context, `platformStackTrace` the Java frames of the calling thread
    # (receive_int is called from a JNI method, so there are some). `maxStackFrames` caps each of them.

    def _receive_int_events(self, run_frooky, find_matched_events, hook_settings, expect_events=True):
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_VALUE}
                hookSettings: {hook_settings}
                hooks:
                  - receive_int
            """)
        run_frooky(hook_file, TARGET_APP, expect_events=expect_events)
        return find_matched_events({"module": MODULE_VALUE, "symbol": "receive_int"})

    def test_no_stack_trace_by_default(self, run_frooky, find_matched_events):
        """Without `platformStackTrace`/`nativeStackTrace`, no frames are captured, which keeps hooks on
        low-level functions (e.g. libc's open) safe on small signal stacks."""
        events = self._receive_int_events(run_frooky, find_matched_events, "{}")

        assert len(events) == 1
        assert events[0]["stackTrace"] == {"platformStackTrace": [], "nativeStackTrace": []}

    def test_native_stack_trace_only(self, run_frooky, find_matched_events):
        """`nativeStackTrace` alone captures the native frames, starting in the JNI caller in the same library."""
        limit = 5
        events = self._receive_int_events(run_frooky, find_matched_events, f"{{nativeStackTrace: true, maxStackFrames: {limit}}}")

        assert len(events) == 1
        native_frames = events[0]["stackTrace"]["nativeStackTrace"]
        assert 0 < len(native_frames) <= limit
        assert MODULE_VALUE in native_frames[0]
        assert events[0]["stackTrace"]["platformStackTrace"] == []

    def test_platform_stack_trace_only(self, run_frooky, find_matched_events):
        """`platformStackTrace` alone captures the Java frames that led to the native call."""
        limit = 5
        events = self._receive_int_events(run_frooky, find_matched_events, f"{{platformStackTrace: true, maxStackFrames: {limit}}}")

        assert len(events) == 1
        platform_frames = events[0]["stackTrace"]["platformStackTrace"]
        assert 0 < len(platform_frames) <= limit
        assert any(frame.startswith("org.owasp.mastestapp") for frame in platform_frames)
        assert events[0]["stackTrace"]["nativeStackTrace"] == []

    def test_native_and_platform_stack_traces_are_capped_separately(self, run_frooky, find_matched_events):
        """With both enabled, `maxStackFrames` applies to each trace on its own."""
        limit = 3
        events = self._receive_int_events(run_frooky, find_matched_events, f"{{nativeStackTrace: true, platformStackTrace: true, maxStackFrames: {limit}}}")

        assert len(events) == 1
        assert 0 < len(events[0]["stackTrace"]["platformStackTrace"]) <= limit
        assert 0 < len(events[0]["stackTrace"]["nativeStackTrace"]) <= limit

    def test_stack_trace_filter_keeps_event_when_a_platform_frame_matches(self, run_frooky, find_matched_events):
        """`stackTraceFilter` is an event-level gate, same as for Java hooks: if any captured frame
        matches, the whole event is kept. The platform stack builder drops the native/JNI frames and
        returns only the Java-side frames leading to the call (see androidStackTrace.ts) - the JNI entry
        point and its Kotlin caller are both in the app's own package, so the filter matches."""
        events = self._receive_int_events(run_frooky, find_matched_events, "{platformStackTrace: true, maxStackFrames: 10, stackTraceFilter: ['^org\\.owasp\\.mastestapp']}")

        assert len(events) == 1
        assert events[0]["stackTrace"]["nativeStackTrace"] == []

    def test_stack_trace_filter_keeps_event_when_a_native_frame_matches(self, run_frooky, find_matched_events):
        """The filter also searches native frames, formatted as `<symbol> (<module>:<address>)`."""
        events = self._receive_int_events(run_frooky, find_matched_events, "{nativeStackTrace: true, maxStackFrames: 10, stackTraceFilter: ['libreceiveFundamentalValue\\.so']}")

        assert len(events) == 1
        assert events[0]["stackTrace"]["platformStackTrace"] == []

    def test_stack_trace_filter_drops_event_when_no_frame_matches(self, run_frooky, find_matched_events):
        """If no captured native or platform frame matches any pattern, the whole event is dropped."""
        events = self._receive_int_events(
            run_frooky,
            find_matched_events,
            "{nativeStackTrace: true, platformStackTrace: true, maxStackFrames: 10, stackTraceFilter: ['^this\\.matches\\.nothing']}",
            expect_events=False,
        )

        assert events == []

    def test_stack_trace_filter_does_not_search_disabled_traces(self, run_frooky, find_matched_events):
        """A pattern matching only Java frames drops the event when only native frames are captured."""
        events = self._receive_int_events(
            run_frooky,
            find_matched_events,
            "{nativeStackTrace: true, maxStackFrames: 10, stackTraceFilter: ['^org\\.owasp\\.mastestapp']}",
            expect_events=False,
        )

        assert events == []

    def test_stack_trace_filter_drops_every_event_without_captured_frames(self, run_frooky, find_matched_events):
        """A `stackTraceFilter` only searches captured frames: with no stack trace enabled nothing can match."""
        events = self._receive_int_events(run_frooky, find_matched_events, "{stackTraceFilter: ['^org\\.owasp\\.mastestapp']}", expect_events=False)

        assert events == []

    def test_same_function_hooked_twice_records_one_event_per_declaration(self, run_frooky, find_matched_events):
        """Multiple hooks (see additional-features.md): two declarations of the same function each record their own
        event per call, decoded with their own params. Both events carry the same `address` and `hashCode`, those of
        receive_int, while another function has its own."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_VALUE}
                decoderSettings:
                  hashCode: true
                hooks:
                  - symbol: receive_int
                    params:
                      - [int, first]
                  - symbol: receive_int
                    params:
                      - [int, second]
                  - receive_bool
            """)

        run_frooky(hook_file, TARGET_APP)

        events = []
        for name in ["first", "second"]:
            expected = {
                "module": MODULE_VALUE,
                "symbol": "receive_int",
                "argsIn": [{"type": "int", "name": name, "value": -2147483648}],
            }
            matched = find_matched_events(expected)
            assert len(matched) == 1, f"the '{name}' declaration did not fire exactly once."
            events += matched

        assert events[0]["address"] == events[1]["address"]
        assert events[0]["hashCode"] == events[1]["hashCode"] == _address_hash_code(events[0]["address"])

        [other] = find_matched_events({"module": MODULE_VALUE, "symbol": "receive_bool"})
        assert other["address"] != events[0]["address"]
        assert other["hashCode"] == _address_hash_code(other["address"])

    def test_identical_declarations_record_one_event(self, run_frooky, count_matched_events):
        """An identical declaration repeated in one hook file is hooked once."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_VALUE}
                hooks:
                  - receive_int
              - module: {MODULE_VALUE}
                hooks:
                  - receive_int
            """)

        run_frooky(hook_file, TARGET_APP)

        assert count_matched_events({"module": MODULE_VALUE, "symbol": "receive_int"}) == 1

    def test_arg_filter_of_one_declaration_does_not_affect_another(self, run_frooky, count_matched_events):
        """Each hook on the same function applies its own filters."""
        hook_file = textwrap.dedent(f"""\
            hookCollection:
              - module: {MODULE_VALUE}
                hooks:
                  - symbol: receive_int
                    params:
                      - [int, filtered, {{argFilter: ['^0$']}}]
                  - symbol: receive_int
                    params:
                      - [int, unfiltered]
            """)

        run_frooky(hook_file, TARGET_APP)

        assert count_matched_events({"symbol": "receive_int", "argsIn": [{"name": "filtered"}]}) == 0
        assert count_matched_events({"symbol": "receive_int", "argsIn": [{"name": "unfiltered", "value": -2147483648}]}) == 1

    def test_removing_one_of_several_hooks_keeps_the_others(self, run_frooky_watch):
        """Multiple hooks + `--watch`: removing a hook on a function from the hook file while frooky runs only
        stops that hook's events, and adding it back hooks it again. More than two hooks on one function
        also checks that every hook's onLeave runs."""

        def hook_file(*names):
            hooks = "".join(f"      - symbol: receive_int\n        params:\n          - [int, {name}]\n" for name in names)
            return f"hookCollection:\n  - module: {MODULE_VALUE}\n    hooks:\n{hooks}"

        def recorded_by(frooky):
            events = frooky.click_start_and_collect({"module": MODULE_VALUE, "symbol": "receive_int"})
            return sorted(event["argsIn"][0]["name"] for event in events)

        frooky = run_frooky_watch(hook_file("A", "B", "C"), TARGET_APP)
        assert recorded_by(frooky) == ["A", "B", "C"]

        frooky.update_hook_file(hook_file("A", "C"))
        assert recorded_by(frooky) == ["A", "C"]

        frooky.update_hook_file(hook_file("C"))
        assert recorded_by(frooky) == ["C"]

        frooky.update_hook_file(hook_file("A", "B", "C"))
        assert recorded_by(frooky) == ["A", "B", "C"]
