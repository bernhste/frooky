"""Unit tests for hook config and user script loading."""

import json
from unittest.mock import MagicMock

import pytest

from frooky.runner.config import (
    compile_user_script,
    load_hook_configs,
    load_user_scripts,
    prepare_user_script,
)


class TestLoadHookConfigs:
    def test_loads_single_yaml_file(self, tmp_path):
        hook_file = tmp_path / "hooks.yaml"
        hook_file.write_text("category: STORAGE\nhooks:\n  - class: com.example.Foo\n    methods: [bar]\n")

        targets = load_hook_configs([hook_file])

        assert targets == [{"category": "STORAGE", "hooks": [{"class": "com.example.Foo", "methods": ["bar"]}]}]

    def test_loads_multiple_files_preserving_order(self, tmp_path):
        first = tmp_path / "first.yaml"
        first.write_text("category: A\nhooks: []\n")
        second = tmp_path / "second.yml"
        second.write_text("category: B\nhooks: []\n")

        targets = load_hook_configs([first, second])

        assert [t["category"] for t in targets] == ["A", "B"]

    def test_loads_yaml_with_c_safe_loader(self, tmp_path):
        hook_file = tmp_path / "hooks.yaml"
        hook_file.write_text("category: CRYPTO\nhooks:\n  - class: javax.crypto.Cipher\n    methods: [doFinal]\n")

        targets = load_hook_configs([hook_file])

        assert targets == [{"category": "CRYPTO", "hooks": [{"class": "javax.crypto.Cipher", "methods": ["doFinal"]}]}]

    def test_loads_deprecated_json_file_and_warns(self, tmp_path, caplog):
        hook_file = tmp_path / "hooks.json"
        hook_file.write_text(json.dumps({"category": "STORAGE", "hooks": []}))

        with caplog.at_level("WARNING"):
            targets = load_hook_configs([hook_file])

        assert targets == [{"category": "STORAGE", "hooks": []}]
        assert "deprecated" in caplog.text.lower()


class TestCompileUserScript:
    def test_compiles_typescript(self, tmp_path):
        ts_file = tmp_path / "unlock.ts"
        ts_file.write_text("const msg: string = 'hello'; console.log(msg);")

        compiled = compile_user_script(ts_file)

        assert "console.log" in compiled
        assert "msg" in compiled

    def test_leaves_bridge_imports_as_external(self, tmp_path):
        ts_file = tmp_path / "unlock.ts"
        ts_file.write_text("import Java from 'frida-java-bridge';\nconst n: number = 42;\nJava.perform(() => console.log(n));")

        compiled = compile_user_script(ts_file)

        assert "frida-java-bridge" in compiled
        assert "const n: number" not in compiled

    def test_compilation_failure_raises_value_error(self, tmp_path):
        ts_file = tmp_path / "broken.ts"
        ts_file.write_text("const x = ;")

        with pytest.raises(ValueError, match="Failed to compile broken.ts"):
            compile_user_script(ts_file)


class TestPrepareUserScript:
    def test_leaves_plain_script_body_intact(self):
        source = "console.log('hello');"
        prepared = prepare_user_script(source)
        assert "console.log('hello');" in prepared
        assert "globalThis.require" in prepared

    def test_resolves_default_import_frida_java_bridge(self):
        source = 'import Java from "frida-java-bridge";\nJava.perform(() => {});'
        prepared = prepare_user_script(source)
        assert 'if (typeof Java === "undefined") {' in prepared
        assert "globalThis.Java = bridge;" in prepared
        assert "var Java = globalThis.Java;\nJava.perform(() => {});" in prepared

    def test_resolves_single_quotes_and_no_semicolon(self):
        source = "import Java from 'frida-java-bridge'\nJava.perform(() => {})"
        prepared = prepare_user_script(source)
        assert 'if (typeof Java === "undefined") {' in prepared
        assert "var Java = globalThis.Java;\nJava.perform(() => {})" in prepared

    def test_resolves_namespace_import(self):
        source = 'import * as Java from "frida-java-bridge";'
        prepared = prepare_user_script(source)
        assert 'if (typeof Java === "undefined") {' in prepared
        assert "var Java = globalThis.Java;" in prepared

    def test_resolves_named_import(self):
        source = 'import { Java } from "frida-java-bridge";'
        prepared = prepare_user_script(source)
        assert 'if (typeof Java === "undefined") {' in prepared
        assert "var Java = globalThis.Java;" in prepared

    def test_resolves_aliased_identifier(self):
        source = 'import myBridge from "frida-java-bridge";\nmyBridge.perform(() => {});'
        prepared = prepare_user_script(source)
        assert 'if (typeof Java === "undefined") {' in prepared
        assert "var myBridge = globalThis.Java;\nmyBridge.perform(() => {});" in prepared

    def test_resolves_require_statement(self):
        source = 'const Java = require("frida-java-bridge");\nJava.perform(() => {});'
        prepared = prepare_user_script(source)
        assert 'if (typeof Java === "undefined") {' in prepared
        assert "var Java = globalThis.Java;\nJava.perform(() => {});" in prepared

    def test_injects_bridge_when_java_used_directly_without_import(self):
        source = "Java.perform(() => console.log('hello'));"
        prepared = prepare_user_script(source)
        assert 'if (typeof Java === "undefined") {' in prepared
        assert "globalThis.Java = bridge;" in prepared
        assert prepared.endswith("Java.perform(() => console.log('hello'));")

    def test_injects_bridge_on_android_platform_even_if_not_imported(self):
        source = "console.log('hooking...');"
        prepared = prepare_user_script(source, platform="android")
        assert 'if (typeof Java === "undefined") {' in prepared
        assert "console.log('hooking...');" in prepared

    def test_resolves_objc_bridge(self):
        source = 'import ObjC from "frida-objc-bridge";\nconsole.log(ObjC.available);'
        prepared = prepare_user_script(source)
        assert 'if (typeof ObjC === "undefined") {' in prepared
        assert "globalThis.ObjC = bridge;" in prepared
        assert "var ObjC = globalThis.ObjC;\nconsole.log(ObjC.available);" in prepared

    def test_resolves_swift_bridge(self):
        source = 'import Swift from "frida-swift-bridge";\nconsole.log(Swift.available);'
        prepared = prepare_user_script(source)
        assert 'if (typeof Swift === "undefined") {' in prepared
        assert "globalThis.Swift = bridge;" in prepared
        assert "var Swift = globalThis.Swift;\nconsole.log(Swift.available);" in prepared


class TestLoadUserScripts:
    def test_loads_and_tracks_each_script(self, tmp_path):
        script_path = tmp_path / "script.js"
        script_path.write_text("console.log('hi')")
        session = MagicMock()
        script_mock = session.create_script.return_value

        scripts = load_user_scripts(session, [script_path], MagicMock())

        called_source = session.create_script.call_args[0][0]
        assert "console.log('hi')" in called_source
        script_mock.set_log_handler.assert_called_once()
        script_mock.load.assert_called_once()
        assert scripts == [script_mock]

    def test_creates_scripts_with_the_given_runtime(self, tmp_path):
        script_path = tmp_path / "script.js"
        script_path.write_text("console.log('hi')")
        session = MagicMock()

        load_user_scripts(session, [script_path], MagicMock(), "v8")

        assert session.create_script.call_args[1]["runtime"] == "v8"

    def test_prepares_script_with_bridges(self, tmp_path):
        script_path = tmp_path / "unlock.js"
        script_path.write_text('import Java from "frida-java-bridge";\nJava.perform(() => {});')
        session = MagicMock()

        load_user_scripts(session, [script_path], MagicMock(), platform="android")

        called_source = session.create_script.call_args[0][0]
        assert 'if (typeof Java === "undefined") {' in called_source
        assert "var Java = globalThis.Java;\nJava.perform(() => {});" in called_source

    def test_compiles_typescript_user_script(self, tmp_path):
        script_path = tmp_path / "unlock.ts"
        script_path.write_text('import Java from "frida-java-bridge";\nconst val: number = 100;\nJava.perform(() => console.log(val));')
        session = MagicMock()

        load_user_scripts(session, [script_path], MagicMock(), platform="android")

        called_source = session.create_script.call_args[0][0]
        assert 'if (typeof Java === "undefined") {' in called_source
        assert "frida-java-bridge" in called_source
        assert "const val: number" not in called_source
