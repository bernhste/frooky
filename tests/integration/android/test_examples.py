"""Runs the example hook files in docs/examples/ against the target apps and checks the events.

Every example documents the events it produces in its `# Expected` comments; these tests check the
same values, so an example that no longer does what it says fails here. native/01_basic_hooking/02_hook_by_offset.yaml
is not run: its offsets only fit one build of the app (see test_hook_by_offset in test_value_passing_native.py).
"""

import re
from pathlib import Path

import pytest

EXAMPLES = Path(__file__).parents[3] / "docs" / "examples"
JAVA_APP = "value-passing-java"
NATIVE_APP = "value-passing-native"
MASTG_CLASS = "org.owasp.mastestapp.MastgTest"


def _example(path):
    return (EXAMPLES / path).read_text(encoding="utf8")


def _cut(value, max_items):
    """A string as decoded with `maxItems`: cut after that many characters, marked with `...`."""
    return value if max_items is None else f"{value[:max_items]}..."


def _values(args):
    return [arg.get("value") for arg in args]


@pytest.mark.parametrize("platform", ["android"], indirect=True)
class TestAndroidExamples:
    def _events(self, find_matched_events, method, java_class=MASTG_CLASS):
        return find_matched_events({"javaClassName": java_class, "method": method})

    def test_hook_by_name(self, run_frooky, find_matched_events):
        run_frooky(_example("android/01_basic_hooking/01_hook_by_name.yaml"), JAVA_APP)

        [string_event] = self._events(find_matched_events, "receiveString")
        assert string_event["argsIn"] == [{"type": "java.lang.String", "value": "Welcome the first OWASP MASCon 📱❤️"}]
        [int_event] = self._events(find_matched_events, "receiveInt")
        assert int_event["argsIn"] == [{"type": "int", "value": 2147483647}]
        overloads = sorted(str(_values(event["argsIn"])) for event in self._events(find_matched_events, "receiveOverloaded"))
        assert overloads == sorted(["[42]", "['frooky']", "['frooky', 42]"])

    def test_select_overloads(self, run_frooky, find_matched_events):
        run_frooky(_example("android/01_basic_hooking/02_select_overloads.yaml"), JAVA_APP)

        events = self._events(find_matched_events, "receiveOverloaded")
        assert sorted(str(_values(event["argsIn"])) for event in events) == ["['frooky', 42]", "[42]"]
        [two_args] = [event for event in events if len(event["argsIn"]) == 2]
        assert two_args["returnValue"]["value"] == "frooky42"

    def test_constructors_and_static_methods(self, run_frooky, find_matched_events):
        run_frooky(_example("android/01_basic_hooking/03_constructors_and_static_methods.yaml"), JAVA_APP)

        [constructor] = find_matched_events({"javaClassName": "org.owasp.mastestapp.Secret"})
        assert constructor["argsIn"] == [{"type": "java.lang.String", "name": "value", "value": "s3cr3t"}]
        assert constructor["returnValue"] == {"type": "void"}
        [static] = self._events(find_matched_events, "receiveStatic", "org.owasp.mastestapp.MastgTestKt")
        assert _values(static["argsIn"]) == ["static"]
        assert static["fieldType"] == {"fieldType": "static"}

    def test_custom_class_loaders(self, run_frooky, find_matched_events):
        run_frooky(_example("android/01_basic_hooking/04_custom_class_loaders.yaml"), JAVA_APP)

        [event] = self._events(find_matched_events, "greet", "org.owasp.mastestapp.PluginGreeter")
        assert event["argsIn"] == [{"type": "java.lang.String", "value": "plugin"}]
        assert event["returnValue"]["value"] == "Hello plugin"

    def test_method_wildcards(self, run_frooky, find_matched_events):
        run_frooky(_example("android/01_basic_hooking/05_method_wildcards.yaml"), JAVA_APP)

        assert {event["method"] for event in find_matched_events({"javaClassName": MASTG_CLASS})} == {"receiveBoolean", "receiveBooleanArray"}
        [bool_event] = self._events(find_matched_events, "receiveBoolean")
        assert bool_event["argsIn"] == [{"type": "boolean", "value": True}]
        [array_event] = self._events(find_matched_events, "receiveBooleanArray")
        assert array_event["argsIn"] == [{"type": "[Z", "value": [True, False]}]

    def test_named_parameters(self, run_frooky, find_matched_events):
        run_frooky(_example("android/02_parameters_and_return_values/01_named_parameters.yaml"), JAVA_APP)

        [event] = self._events(find_matched_events, "receiveOverloaded")
        assert event["argsIn"] == [
            {"type": "java.lang.String", "name": "prefix", "value": "frooky"},
            {"type": "int", "name": "suffix", "value": 42},
        ]

    def test_output_parameters(self, run_frooky, find_matched_events):
        run_frooky(_example("android/02_parameters_and_return_values/02_output_parameters.yaml"), JAVA_APP)

        [fill] = self._events(find_matched_events, "fillSecret")
        assert fill["argsIn"] == []
        assert fill["argsOut"] == [{"type": "[B", "name": "out", "value": "s3cr3t"}]
        assert fill["returnValue"] == {"type": "int", "value": 6}
        [toggle] = self._events(find_matched_events, "toggleCase")
        assert _values(toggle["argsIn"]) == ["frooky"]
        assert _values(toggle["argsOut"]) == ["FROOKY"]

    def test_return_values(self, run_frooky, find_matched_events):
        run_frooky(_example("android/02_parameters_and_return_values/03_return_values.yaml"), JAVA_APP)

        [toggle] = self._events(find_matched_events, "toggleCase")
        assert toggle["returnValue"] == {"type": "[B", "value": "FROOKY"}
        [big_integer] = self._events(find_matched_events, "receiveBigInteger")
        assert re.fullmatch(r"java\.math\.BigInteger@[0-9a-f]+", big_integer["returnValue"]["value"])

    def test_java_types(self, run_frooky, find_matched_events):
        run_frooky(_example("android/03_decoders/01_java_types.yaml"), JAVA_APP)

        expected = {
            "receiveBoolean": True,
            "receiveChar": "A",
            "receiveLong": "9223372036854775807",
            "receiveDouble": 3.141592653589793,
            "receiveStringArray": ["a", "b", "c"],
            "receiveCharArray": ["x", "y", "z"],
            "receiveNestedPrimitivesArray": [[[1, 2, 3], [4, 5, 6]], [[7, 8, 9], [10, 11, 12]]],
            "receiveEnum": {"type": "org.owasp.mastestapp.MastgTest$Direction", "value": "NORTH"},
            "receiveBigDecimal": {"type": "java.math.BigDecimal", "value": "3.141592653589793238462643383"},
            # name(), toString() of HIGH is "high!"
            "receiveLevel": {"type": "org.owasp.mastestapp.Level$HIGH", "value": "HIGH"},
            "receiveByteBuffer": {
                "type": "java.nio.HeapByteBuffer",
                "value": {"position": 2, "limit": 6, "capacity": 6, "direct": False, "readOnly": False, "remaining": "0x6f6f6b79"},
            },
            "receiveCharSequence": {"type": "java.lang.StringBuilder", "value": "built text"},
            "receiveMapEntry": {
                "type": "java.util.AbstractMap$SimpleImmutableEntry",
                "value": [
                    {"type": "java.lang.String", "name": "key", "value": "token"},
                    {"type": "java.lang.String", "name": "value", "value": "abc123"},
                ],
            },
        }
        for method, value in expected.items():
            [event] = self._events(find_matched_events, method)
            assert event["argsIn"][0]["value"] == value, method

        def strings(decoded):
            return [item["value"] for item in decoded]

        [list_event] = self._events(find_matched_events, "receiveList")
        assert strings(list_event["argsIn"][0]["value"]["value"]) == ["a", "b", "c"]
        [set_event] = self._events(find_matched_events, "receiveSet")
        assert strings(set_event["argsIn"][0]["value"]["value"]) == ["a", "b", "c"]
        [map_event] = self._events(find_matched_events, "receiveMap")
        assert {part["name"]: strings(part["value"]) for part in map_event["argsIn"][0]["value"]["value"]} == {"key": ["key"], "value": ["value"]}

    def test_android_types(self, run_frooky, find_matched_events):
        run_frooky(_example("android/03_decoders/02_android_types.yaml"), JAVA_APP)

        [bundle] = self._events(find_matched_events, "receiveBundle")
        extras = {extra["name"]: extra["value"] for extra in bundle["argsIn"][0]["value"]["value"]}
        assert extras == {"user": "alice", "age": 42, "roles": ["admin", "dev"]}
        [content_values] = self._events(find_matched_events, "receiveContentValues")
        assert content_values["argsIn"][0]["value"]["value"] == {"name": "alice", "score": "42"}
        [clip_data] = self._events(find_matched_events, "receiveClipData")
        clip = clip_data["argsIn"][0]["value"]["value"]
        assert clip["itemCount"] == 1
        assert clip["items"][0]["value"]["text"] == "copied secret"
        [intent] = self._events(find_matched_events, "receiveIntent")
        fields = {field["name"]: field["value"] for field in intent["argsIn"][0]["value"]["value"]}
        assert fields["action"] == "android.intent.action.VIEW"
        assert fields["data"]["value"] == "https://example.org"
        [persistable] = self._events(find_matched_events, "receivePersistableBundle")
        assert persistable["argsIn"][0]["value"]["value"] == [{"type": "java.lang.String", "name": "user", "value": "alice"}]
        [location] = self._events(find_matched_events, "receiveLocation")
        assert location["argsIn"][0]["value"]["value"] == {
            "provider": "gps",
            "latitude": 47.3769,
            "longitude": 8.5417,
            "accuracy": 5,
            "altitude": None,
            "speed": None,
            "bearing": None,
            "time": "1970-01-01T00:00:00.000Z",
            "mock": False,
        }
        [request] = self._events(find_matched_events, "receiveWebResourceRequest")
        properties = {prop["name"]: prop["value"] for prop in request["argsIn"][0]["value"]["value"]}
        assert properties["method"] == "POST"
        assert properties["url"]["value"] == "https://example.org/api"
        assert properties["forMainFrame"] is False
        headers = properties["requestHeaders"]["value"]
        assert [[item["value"] for item in part["value"]] for part in headers] == [["Authorization"], ["Bearer abc123"]]

    def test_custom_decoders(self, run_frooky, find_matched_events):
        run_frooky(_example("android/03_decoders/03_custom_decoders.yaml"), JAVA_APP)

        [text] = self._events(find_matched_events, "receiveTextBytes")
        assert _values(text["argsIn"]) == ["Hello frooky"]
        [big_integer] = self._events(find_matched_events, "receiveBigInteger")
        assert re.fullmatch(r"java\.math\.BigInteger@[0-9a-f]+", big_integer["argsIn"][0]["value"])
        [password] = self._events(find_matched_events, "receivePassword")
        assert password["argsIn"] == [{"type": "[C", "name": "password", "value": "s3cr3t"}]
        base64_values = sorted(event["argsIn"][0]["value"] for event in self._events(find_matched_events, "receiveBase64"))
        assert base64_values == ["0x000102030405060708090a0b0c0d0e0f", "Hello frooky"]
        [profile] = self._events(find_matched_events, "receiveProfile")
        assert {prop["name"]: prop["value"] for prop in profile["argsIn"][0]["value"]} == {"name": "alice", "age": 42, "admin": True}
        modes = sorted(event["argsIn"][0]["name"] + "=" + event["argsIn"][0]["value"] for event in self._events(find_matched_events, "receiveMode"))
        assert modes == ["mode=MODE_DECRYPT", "opmode=DECRYPT"]
        builders = find_matched_events({"javaClassName": "android.security.keystore.KeyGenParameterSpec$Builder"})
        assert ["TestKeyPair", ["PURPOSE_SIGN", "PURPOSE_VERIFY"]] in [_values(event["argsIn"]) for event in builders]
        # init is a framework method, so the app process may call it more than once
        opmodes = [event["argsIn"][0]["value"] for event in self._events(find_matched_events, "init", "javax.crypto.Cipher")]
        assert "ENCRYPT_MODE" in opmodes
        assert "PUBLIC_KEY" not in opmodes
        # setFlags is a framework method, so the app process may call it more than once
        flags = [event["argsIn"][0] for event in self._events(find_matched_events, "setFlags", "android.content.Intent")]
        expected_flags = {
            "FLAG_GRANT_READ_URI_PERMISSION",
            "FLAG_GRANT_WRITE_URI_PERMISSION",
            "FLAG_GRANT_PERSISTABLE_URI_PERMISSION",
            "FLAG_GRANT_PREFIX_URI_PERMISSION",
            "FLAG_ACTIVITY_NEW_TASK",
            "FLAG_ACTIVITY_CLEAR_TASK",
        }
        assert any(flag["type"] == "android.content.IntentFlag" and set(flag["value"]) == expected_flags for flag in flags)
        parse_uri = [event for event in self._events(find_matched_events, "parseUri", "android.content.Intent") if event["argsIn"][0]["value"] == "intent:#Intent;action=android.intent.action.VIEW;end"]
        assert len(parse_uri) == 1
        assert parse_uri[0]["argsIn"][1]["value"] == ["URI_INTENT_SCHEME"]

    def test_decoder_resolution(self, run_frooky, find_matched_events):
        run_frooky(_example("android/03_decoders/04_decoder_resolution.yaml"), JAVA_APP)

        def map_entries(decoded):
            keys, values = ([item["value"] for item in part["value"]] for part in decoded["value"])
            return dict(zip(keys, values))

        # LabeledIntent: the class decoder of its superclass Intent, `decoder: string` for the return value
        [parcelable] = self._events(find_matched_events, "receiveParcelable")
        intent = parcelable["argsIn"][0]["value"]
        assert intent["type"] == "android.content.Intent"
        assert {field["name"]: field["value"] for field in intent["value"]}["action"] == "android.intent.action.SEND"
        assert parcelable["returnValue"]["value"] == "Intent { act=android.intent.action.SEND }"
        # TreeMap declared as Object: the interface decoder of Map
        [any_event] = self._events(find_matched_events, "receiveAny")
        tree_map = any_event["argsIn"][0]["value"]
        assert tree_map["type"] == "java.util.TreeMap"
        assert map_entries(tree_map) == {"a": "1", "b": "2"}
        # Headers implements Map and Iterable: Map comes first in the registry
        [headers] = self._events(find_matched_events, "receiveHeaders")
        assert map_entries(headers["argsIn"][0]["value"]) == {"Accept": "application/json"}

    def test_crypto_types(self, run_frooky, find_matched_events):
        run_frooky(_example("android/03_decoders/05_crypto_types.yaml"), JAVA_APP)

        def decoded(method):
            [event] = self._events(find_matched_events, method)
            return event["argsIn"][0]["value"]

        def properties(value):
            return {prop["name"]: prop["value"] for prop in value["value"]}

        assert decoded("receiveKey") == {
            "type": "javax.crypto.spec.SecretKeySpec",
            "value": {"algorithm": "AES", "format": "RAW", "encoded": "0x000102030405060708090a0b0c0d0e0f"},
        }
        assert properties(decoded("receiveParameterSpec")) == {"TLen": 128, "IV": "0x000102030405060708090a0b"}
        assert properties(decoded("receiveKeySpec")) == {"password": "s3cr3t", "salt": "0x0a0b", "iterationCount": 1000, "keyLength": 256}

        cipher = decoded("receiveCipher")["value"]
        assert cipher == {
            "algorithm": "AES/GCM/NoPadding",
            "initialized": True,
            "opmode": "ENCRYPT_MODE",
            "provider": cipher["provider"],
            "iv": "0x000102030405060708090a0b",
            "blockSize": 16,
        }
        assert cipher["provider"]
        # not initialized, so no provider is chosen yet
        assert decoded("receiveMac")["value"] == {"algorithm": "HmacSHA256", "initialized": False, "provider": None, "macLength": None}
        signature = decoded("receiveSignature")["value"]
        assert (signature["algorithm"], signature["state"]) == ("SHA256withECDSA", "SIGN")
        assert signature["provider"]
        digest = decoded("receiveMessageDigest")["value"]
        assert (digest["algorithm"], digest["digestLength"]) == ("SHA-256", 32)

        certificate = decoded("receiveCertificate")["value"]
        assert "CN=Android Debug" in certificate["subject"]
        assert re.fullmatch(r"[0-9a-f]{64}", certificate["sha256"])
        # the app signature is the DER encoding of the same certificate
        assert decoded("receiveAppSignature")["value"] == certificate
        assert properties(decoded("receiveCryptoObject"))["cipher"]["value"] == cipher
        assert properties(decoded("receiveAndroidXCryptoObject"))["cipher"]["value"] == cipher

    def test_max_items(self, run_frooky, find_matched_events):
        run_frooky(_example("android/04_decoder_settings/01_max_items.yaml"), JAVA_APP)

        arrays = [event["argsIn"][0]["value"] for event in self._events(find_matched_events, "receiveIntArray")]
        assert sorted(arrays, key=len) == [[1, 2, 3], [1, 2, 3, 4, 5, "[truncated at 5]"]]
        [string] = self._events(find_matched_events, "receiveString")
        assert _values(string["argsIn"]) == ["Welcome..."]
        [list_event] = self._events(find_matched_events, "receiveList")
        assert [item["value"] for item in list_event["argsIn"][0]["value"]["value"]] == ["a", "b", "[truncated at 2]"]

    def test_max_depth(self, run_frooky, find_matched_events):
        run_frooky(_example("android/04_decoder_settings/02_max_depth.yaml"), JAVA_APP)

        [event] = self._events(find_matched_events, "receiveNestedPrimitivesArray")
        assert _values(event["argsIn"]) == [[["[max depth reached]"] * 2] * 2]

    def test_arg_filter(self, run_frooky, find_matched_events):
        run_frooky(_example("android/04_decoder_settings/03_arg_filter.yaml"), JAVA_APP)

        assert [_values(event["argsIn"]) for event in self._events(find_matched_events, "trackEvent")] == [["button_click"]]
        assert [_values(event["argsIn"]) for event in self._events(find_matched_events, "receiveInt")] == [[2147483647]]

    def test_decoder_args(self, run_frooky, find_matched_events):
        run_frooky(_example("android/04_decoder_settings/04_decoder_args.yaml"), JAVA_APP)

        # the framework may create other keys, the app's key has the offset 16
        keys = [event for event in find_matched_events({"javaClassName": "javax.crypto.spec.SecretKeySpec"}) if event["argsIn"][1]["value"] == 16]
        assert len(keys) == 1
        assert _values(keys[0]["argsIn"]) == [list(range(16, 32)), 16, 16, "AES"]
        [packet] = self._events(find_matched_events, "sendPacket")
        assert _values(packet["argsIn"]) == ["hello frooky", 7, 12]

    def test_platform_stack_trace(self, run_frooky, find_matched_events):
        run_frooky(_example("android/05_hook_settings/01_platform_stack_trace.yaml"), JAVA_APP)

        traces = {event["argsIn"][0]["value"]: event["stackTrace"] for event in self._events(find_matched_events, "trackEvent")}
        assert set(traces) == {"button_click", "sdk_flush"}
        for trace in traces.values():
            assert len(trace["platformStackTrace"]) == 3
            assert trace["platformStackTrace"][0].startswith(f"{MASTG_CLASS}.trackEvent ")
            assert trace["nativeStackTrace"] == []
        assert traces["button_click"]["platformStackTrace"][1].startswith(f"{MASTG_CLASS}.mastgTest ")
        assert traces["sdk_flush"]["platformStackTrace"][1].startswith("org.owasp.mastestapp.ThirdPartySdk.flush ")

    def test_caller_filter(self, run_frooky, find_matched_events):
        run_frooky(_example("android/05_hook_settings/02_caller_filter.yaml"), JAVA_APP)

        assert [_values(event["argsIn"]) for event in self._events(find_matched_events, "trackEvent")] == [["sdk_flush"]]

    @pytest.mark.parametrize(
        "example, max_stack_frames, arg_max_items, ret_max_items",
        [
            ("01_default_settings.yaml", 0, None, None),
            ("02_file_settings.yaml", 1, 10, 10),
            ("03_hook_collection_settings.yaml", 2, 15, 15),
            ("04_hook_settings.yaml", 3, 20, 20),
            ("05_param_and_return_type_settings.yaml", 3, 25, 30),
            ("06_partial_overrides.yaml", 3, 15, 30),
        ],
    )
    def test_settings_precedence(self, run_frooky, find_matched_events, example, max_stack_frames, arg_max_items, ret_max_items):
        """The closest level that sets a field wins; fields it leaves out fall through to the next level out."""
        run_frooky(_example(f"android/06_settings_precedence/{example}"), JAVA_APP)

        received = "Welcome the first OWASP MASCon 📱❤️"
        [event] = self._events(find_matched_events, "receiveString")
        assert event["argsIn"] == [{"type": "java.lang.String", "name": "arg", "value": _cut(received, arg_max_items)}]
        assert event["returnValue"] == {"type": "java.lang.String", "value": _cut(received, ret_max_items)}
        platform_frames = event["stackTrace"]["platformStackTrace"]
        assert len(platform_frames) == max_stack_frames
        if platform_frames:
            assert platform_frames[0].startswith(f"{MASTG_CLASS}.receiveString ")
        assert event["stackTrace"]["nativeStackTrace"] == []

    def test_multiple_hooks(self, run_frooky, find_matched_events):
        run_frooky(_example("android/07_multiple_hooks/01_multiple_hooks.yaml"), JAVA_APP)

        strings = sorted((arg["name"], arg["value"]) for event in self._events(find_matched_events, "receiveString") for arg in event["argsIn"])
        assert strings == [("first", "Welcome the first OWASP MASCon 📱❤️"), ("second", "Welco...")]
        assert sorted(arg["name"] for event in self._events(find_matched_events, "receiveInt") for arg in event["argsIn"]) == ["maxValue", "value"]
        assert len(self._events(find_matched_events, "receiveBoolean")) == 1

    def test_early_hooking_with_spawn(self, run_frooky_spawn, find_matched_events):
        run_frooky_spawn(_example("android/08_early_hooking/01_spawn_vs_attach.yaml"), JAVA_APP)

        [event] = self._events(find_matched_events, "onCreate", "org.owasp.mastestapp.MainActivity")
        assert event["argsIn"] == [{"type": "android.os.Bundle", "name": "savedInstanceState", "value": None}]

    def test_early_hooking_with_attach(self, run_frooky, find_matched_events):
        run_frooky(_example("android/08_early_hooking/01_spawn_vs_attach.yaml"), JAVA_APP, expect_events=False)

        assert self._events(find_matched_events, "onCreate", "org.owasp.mastestapp.MainActivity") == []


@pytest.mark.parametrize("platform", ["android"], indirect=True)
class TestNativeExamples:
    def _events(self, find_matched_events, symbol, module=None):
        return find_matched_events({"symbol": symbol, **({"module": module} if module else {})})

    def test_hook_by_symbol(self, run_frooky, find_matched_events):
        run_frooky(_example("native/01_basic_hooking/01_hook_by_symbol.yaml"), NATIVE_APP)

        [bool_event] = self._events(find_matched_events, "receive_bool")
        assert bool_event["argsIn"] == []
        [int_event] = self._events(find_matched_events, "receive_int")
        assert int_event["argsIn"] == [{"type": "int", "value": -2147483648}, {"type": "int", "value": 2147483647}]
        assert int_event["returnValue"]["value"] == -2147483648

    def test_symbol_wildcards(self, run_frooky, find_matched_events):
        run_frooky(_example("native/01_basic_hooking/03_symbol_wildcards.yaml"), NATIVE_APP)

        module = "libreceiveFundamentalReference.so"
        assert {event["symbol"] for event in find_matched_events({"module": module})} == {"receive_int_ref", "receive_uint_ref"}
        for symbol in ["receive_int_ref", "receive_uint_ref"]:
            [event] = self._events(find_matched_events, symbol, module)
            assert event["argsIn"] == []
            assert "returnValue" not in event

    def test_values_and_pointers(self, run_frooky, find_matched_events):
        run_frooky(_example("native/02_parameters_and_return_values/01_values_and_pointers.yaml"), NATIVE_APP)

        [int_event] = self._events(find_matched_events, "receive_int")
        assert int_event["argsIn"] == [{"type": "int", "name": "minValue", "value": -2147483648}, {"type": "int", "name": "maxValue", "value": 2147483647}]
        [double_event] = self._events(find_matched_events, "receive_double")
        assert _values(double_event["argsIn"]) == [-1.7976931348623157e308, 1.7976931348623157e308]
        [ref_event] = self._events(find_matched_events, "receive_int_ref")
        assert _values(ref_event["argsIn"]) == [-2147483648, 2147483647]
        [string_event] = self._events(find_matched_events, "receive_cstring")
        assert string_event["argsIn"] == [{"type": "char *", "name": "s", "value": "Welcome the first OWASP MASCon, CString!"}]

    def test_output_parameters(self, run_frooky, find_matched_events):
        run_frooky(_example("native/02_parameters_and_return_values/02_output_parameters.yaml"), NATIVE_APP)

        [secret] = self._events(find_matched_events, "get_secret")
        assert secret["argsIn"] == [{"type": "int", "name": "out_len", "value": 16}]
        assert secret["argsOut"] == [{"type": "char *", "name": "out", "value": "s3cr3t"}]
        assert secret["returnValue"] == {"type": "int", "value": 6}
        [byte_array] = self._events(find_matched_events, "receive_byte_array")
        assert byte_array["argsIn"][0]["value"] == "0x48656c6c6f"
        assert byte_array["argsOut"][0]["value"] == "0xb79a939390"

    def test_return_values(self, run_frooky, find_matched_events):
        run_frooky(_example("native/02_parameters_and_return_values/03_return_values.yaml"), NATIVE_APP)

        [string_event] = self._events(find_matched_events, "receive_cstring")
        assert string_event["returnValue"] == {"type": "char *", "value": "Welcome..."}
        [double_event] = self._events(find_matched_events, "receive_double")
        assert double_event["returnValue"] == {"type": "double", "value": -1.7976931348623157e308}

    def test_strings_and_buffers(self, run_frooky, find_matched_events):
        run_frooky(_example("native/03_decoders/01_strings_and_buffers.yaml"), NATIVE_APP)

        [utf8] = self._events(find_matched_events, "receive_utf8")
        assert _values(utf8["argsIn"]) == ["Welcome the first OWASP MASCon 📱❤️"]
        messages = sorted((event["argsIn"][0]["name"], event["argsIn"][0]["value"]) for event in self._events(find_matched_events, "send_message"))
        assert messages == [("buf", "0x48656c6c6f2066726f6f6b79"), ("text", "Hello frooky")]
        [utf16] = self._events(find_matched_events, "receive_utf16")
        assert _values(utf16["argsIn"]) == ["Grüezi", 6]
        [utf16_cstring] = self._events(find_matched_events, "receive_utf16_cstring")
        assert _values(utf16_cstring["argsIn"]) == ["Hello UTF-16"]
        [read_message] = self._events(find_matched_events, "read_message")
        assert read_message["argsOut"] == [{"type": "void *", "name": "buf", "value": "Hello frooky"}]
        assert read_message["returnValue"]["value"] == 12

    def test_pointers_and_arrays(self, run_frooky, find_matched_events):
        run_frooky(_example("native/03_decoders/02_pointers_and_arrays.yaml"), NATIVE_APP)

        [sum_ints] = self._events(find_matched_events, "sum_ints")
        assert sum_ints["argsIn"] == [{"type": "const int *", "name": "values", "value": [3, 1, 4, 1, 5]}, {"type": "int", "name": "count", "value": 5}]
        assert sum_ints["returnValue"]["value"] == 14
        [count_chars] = self._events(find_matched_events, "count_chars")
        assert count_chars["argsIn"][0] == {"type": "const char **", "name": "strings", "value": ["alpha", "beta", "gamma"]}
        [count_args] = self._events(find_matched_events, "count_args")
        assert count_args["argsIn"] == [{"type": "char *const []", "name": "argv", "value": ["ls", "-l", "/sdcard"]}]
        assert count_args["returnValue"]["value"] == 3
        [get_version] = self._events(find_matched_events, "get_version")
        assert get_version["argsOut"] == [{"type": "const char **", "name": "out", "value": "1.2.3"}]

    def test_file_descriptors(self, run_frooky, find_matched_events):
        run_frooky(_example("native/03_decoders/03_file_descriptors.yaml"), NATIVE_APP)

        writes = {event["argsIn"][1]["value"]: event["argsIn"][0]["value"] for event in self._events(find_matched_events, "write_log")}
        assert set(writes) == {"started", "ping"}
        assert writes["started"] == {"fd": writes["started"]["fd"], "path": "/dev/null"}
        socket = writes["ping"]
        assert re.fullmatch(r"socket:\[\d+\]", socket["path"])
        assert socket["family"] == "AF_INET"
        assert socket["socketType"] == "SOCK_DGRAM"
        assert re.fullmatch(r"127\.0\.0\.1:\d+", socket["local"])
        assert socket["peer"] == "127.0.0.1:9"
        [open_log] = self._events(find_matched_events, "open_log")
        assert open_log["returnValue"]["value"] == {"fd": writes["started"]["fd"], "path": "/dev/null"}

    def test_constants_and_bitmasks(self, run_frooky, find_matched_events):
        run_frooky(_example("native/03_decoders/04_constants_and_bitmasks.yaml"), NATIVE_APP)

        [log_level] = self._events(find_matched_events, "set_log_level")
        assert _values(log_level["argsIn"]) == ["LOG_LEVEL_WARN"]
        [permissions] = self._events(find_matched_events, "set_permissions")
        assert _values(permissions["argsIn"]) == [["PERMISSION_READ", "PERMISSION_SHARE", "0x100"]]
        [open_log] = self._events(find_matched_events, "open_log")
        assert open_log["argsIn"][1] == {"type": "int", "name": "flags", "value": ["O_WRONLY", "O_CREAT", "O_TRUNC", "O_CLOEXEC"]}
        [open_socket] = self._events(find_matched_events, "open_socket")
        assert _values(open_socket["argsIn"]) == ["AF_INET", ["SOCK_DGRAM", "SOCK_CLOEXEC"]]
        [map_page] = self._events(find_matched_events, "map_page")
        assert _values(map_page["argsIn"]) == [["PROT_READ", "PROT_WRITE"], ["MAP_PRIVATE", "MAP_ANONYMOUS"]]

    def test_errno(self, run_frooky, find_matched_events):
        run_frooky(_example("native/03_decoders/05_errno.yaml"), NATIVE_APP)

        [delete_cache] = self._events(find_matched_events, "delete_cache")
        assert delete_cache["returnValue"] == {
            "type": "int",
            "value": {"value": -1, "errno": {"number": 2, "name": "ENOENT", "message": "No such file or directory"}},
        }
        [read_status] = self._events(find_matched_events, "read_status")
        assert read_status["returnValue"]["value"] == {"value": ord("N"), "errno": None}

    def test_max_items(self, run_frooky, find_matched_events):
        run_frooky(_example("native/04_decoder_settings/01_max_items.yaml"), NATIVE_APP)

        [string_event] = self._events(find_matched_events, "receive_cstring")
        assert _values(string_event["argsIn"]) == ["Welcome..."]
        [message] = self._events(find_matched_events, "send_message")
        assert message["argsIn"][0]["value"] == "0x48656c6c6f..."

    def test_arg_filter(self, run_frooky, find_matched_events):
        run_frooky(_example("native/04_decoder_settings/02_arg_filter.yaml"), NATIVE_APP)

        assert [_values(event["argsIn"]) for event in self._events(find_matched_events, "track_event")] == [["button_click"]]

    def test_native_and_platform_stack_traces(self, run_frooky, find_matched_events):
        run_frooky(_example("native/05_hook_settings/01_native_and_platform_stack_traces.yaml"), NATIVE_APP)

        traces = {event["argsIn"][0]["value"]: event["stackTrace"] for event in self._events(find_matched_events, "track_event")}
        assert set(traces) == {"button_click", "sdk_flush"}
        for trace in traces.values():
            assert len(trace["nativeStackTrace"]) == 2
            assert trace["platformStackTrace"][0].startswith(f"{MASTG_CLASS}.receiveStringsJNI ")
        assert traces["button_click"]["nativeStackTrace"][0].startswith("Java_org_owasp_mastestapp_MastgTest_receiveStringsJNI+0x")
        assert traces["sdk_flush"]["nativeStackTrace"][0].startswith("sdk_flush+0x")

    def test_caller_filter(self, run_frooky, find_matched_events):
        run_frooky(_example("native/05_hook_settings/02_caller_filter.yaml"), NATIVE_APP)

        assert [_values(event["argsIn"]) for event in self._events(find_matched_events, "fopen", "libc.so")] == [["/proc/self/status", "r"]]
        [unlink] = self._events(find_matched_events, "unlink", "libc.so")
        assert _values(unlink["argsIn"]) == ["/proc/self/frooky-missing-cache"]
        assert unlink["returnValue"]["value"]["value"] == -1
        assert unlink["returnValue"]["value"]["errno"]["name"] == "ENOENT"

    def test_low_level_functions(self, run_frooky, find_matched_events):
        run_frooky(_example("native/05_hook_settings/03_low_level_functions.yaml"), NATIVE_APP)

        events = self._events(find_matched_events, "open", "libc.so")
        assert len(events) >= 1
        for event in events:
            assert _values(event["argsIn"]) == ["/proc/self/status", 0]
            assert event["returnValue"]["value"] >= 0
            assert event["stackTrace"] == {"platformStackTrace": [], "nativeStackTrace": []}

    @pytest.mark.parametrize(
        "example, max_stack_frames, arg_max_items, ret_max_items",
        [
            ("01_default_settings.yaml", 0, None, None),
            ("02_file_settings.yaml", 1, 10, 10),
            ("03_hook_collection_settings.yaml", 2, 15, 15),
            ("04_hook_settings.yaml", 3, 20, 20),
            ("05_param_and_return_type_settings.yaml", 3, 25, 30),
            ("06_partial_overrides.yaml", 3, 15, 30),
        ],
    )
    def test_settings_precedence(self, run_frooky, find_matched_events, example, max_stack_frames, arg_max_items, ret_max_items):
        """The closest level that sets a field wins; fields it leaves out fall through to the next level out."""
        run_frooky(_example(f"native/06_settings_precedence/{example}"), NATIVE_APP)

        received = "Welcome the first OWASP MASCon, CString!"
        [event] = self._events(find_matched_events, "receive_cstring")
        assert event["argsIn"] == [{"type": "char *", "name": "s", "value": _cut(received, arg_max_items)}]
        assert event["returnValue"] == {"type": "char *", "value": _cut(received, ret_max_items)}
        assert len(event["stackTrace"]["platformStackTrace"]) == max_stack_frames
        assert len(event["stackTrace"]["nativeStackTrace"]) == max_stack_frames

    def test_multiple_hooks(self, run_frooky, find_matched_events):
        run_frooky(_example("native/07_multiple_hooks/01_multiple_hooks.yaml"), NATIVE_APP)

        assert len(self._events(find_matched_events, "receive_int")) == 2
        assert len(self._events(find_matched_events, "receive_long")) == 2

    def test_early_hooking_with_spawn(self, run_frooky_spawn, find_matched_events):
        run_frooky_spawn(_example("native/08_early_hooking/01_spawn_vs_attach.yaml"), NATIVE_APP)

        libraries = sorted(event["argsIn"][0]["value"].rsplit("/", 1)[1] for event in self._events(find_matched_events, "android_dlopen_ext"))
        assert libraries == ["libreceiveFundamentalReference.so", "libreceiveFundamentalValue.so", "libreceiveString.so"]

    def test_early_hooking_with_attach(self, run_frooky, find_matched_events):
        run_frooky(_example("native/08_early_hooking/01_spawn_vs_attach.yaml"), NATIVE_APP, expect_events=False)

        assert self._events(find_matched_events, "android_dlopen_ext") == []

    def test_calls_while_loading(self, run_frooky_spawn, find_matched_events):
        run_frooky_spawn(_example("native/08_early_hooking/02_calls_while_loading.yaml"), NATIVE_APP)

        assert len(self._events(find_matched_events, "load_time_constructor", "libloadTime.so")) == 1
        events = self._events(find_matched_events, "report_load_stage", "libloadStage.so")
        assert [event["argsIn"] for event in events] == [
            [{"type": "char *", "name": "stage", "value": "constructor"}],
            [{"type": "char *", "name": "stage", "value": "JNI_OnLoad"}],
        ]

    def test_stack_traces_while_loading(self, run_frooky_spawn, find_matched_events):
        run_frooky_spawn(_example("native/08_early_hooking/03_stack_traces_while_loading.yaml"), NATIVE_APP)

        traces = {event["argsIn"][0]["value"]: event["stackTrace"] for event in self._events(find_matched_events, "report_load_stage", "libloadStage.so")}
        assert set(traces) == {"constructor", "JNI_OnLoad"}
        # only the app's frames: the linker's, ART's and java.lang.Runtime's differ between Android versions
        for trace in traces.values():
            assert "skipped" not in trace
            assert any(frame.startswith(f"{MASTG_CLASS}.<clinit> ") for frame in trace["platformStackTrace"])
        assert traces["constructor"]["nativeStackTrace"][0].startswith("load_time_constructor+0x")
        assert traces["JNI_OnLoad"]["nativeStackTrace"][0].startswith("JNI_OnLoad+0x")
