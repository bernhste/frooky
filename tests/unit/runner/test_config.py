"""Unit tests for hook config and user script loading."""

import json
from unittest.mock import MagicMock

import pytest

from frooky.runner.config import (
    compile_user_script,
    load_hook_configs,
    load_user_scripts,
    uses_java_bridge,
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

    def test_turns_bridge_imports_into_require_calls(self, tmp_path):
        ts_file = tmp_path / "unlock.ts"
        ts_file.write_text("import Java from 'frida-java-bridge';\nconst n: number = 42;\nJava.perform(() => console.log(n));")

        compiled = compile_user_script(ts_file)

        assert '__require("frida-java-bridge")' in compiled
        assert "const n: number" not in compiled

    def test_compiles_javascript_with_an_import(self, tmp_path):
        js_file = tmp_path / "unlock.js"
        js_file.write_text('import Java from "frida-java-bridge";\nJava.perform(() => {});')

        compiled = compile_user_script(js_file)

        assert '__require("frida-java-bridge")' in compiled
        assert "import Java" not in compiled

    def test_compilation_failure_raises_value_error(self, tmp_path):
        ts_file = tmp_path / "broken.ts"
        ts_file.write_text("const x = ;")

        with pytest.raises(ValueError, match="Failed to compile broken.ts"):
            compile_user_script(ts_file)


class TestUsesJavaBridge:
    @pytest.mark.parametrize(
        "source",
        [
            'var import_bridge = __toESM(__require("frida-java-bridge"));',
            'var Java = __require("frida-java-bridge");',
            "Java.perform(() => {});",
        ],
    )
    def test_detects_the_bridge(self, source):
        assert uses_java_bridge(source)

    @pytest.mark.parametrize("source", ["Interceptor.attach(ptr(1), {});", "const JavaScript = 1;", "var java = 1;"])
    def test_ignores_scripts_without_the_bridge(self, source):
        assert not uses_java_bridge(source)


class TestLoadUserScripts:
    def test_runs_a_script_using_the_java_bridge_in_the_agent(self, tmp_path):
        script_path = tmp_path / "unlock.js"
        script_path.write_text("Java.perform(() => {});")
        session, agent = MagicMock(), MagicMock()

        scripts = load_user_scripts(session, agent, [script_path], MagicMock())

        name, source = agent.exports_sync.load_user_script.call_args[0]
        assert name == "unlock.js"
        assert "Java.perform(" in source
        session.create_script.assert_not_called()
        assert scripts == []

    def test_loads_a_script_without_the_java_bridge_as_its_own_script(self, tmp_path):
        script_path = tmp_path / "script.js"
        script_path.write_text("console.log('hi')")
        session, agent = MagicMock(), MagicMock()
        script_mock = session.create_script.return_value

        scripts = load_user_scripts(session, agent, [script_path], MagicMock(), "v8")

        assert "console.log(" in session.create_script.call_args[0][0]
        assert session.create_script.call_args[1]["runtime"] == "v8"
        script_mock.set_log_handler.assert_called_once()
        script_mock.load.assert_called_once()
        agent.exports_sync.load_user_script.assert_not_called()
        assert scripts == [script_mock]

    def test_keeps_the_order_of_the_scripts(self, tmp_path):
        paths = [tmp_path / "a.js", tmp_path / "b.ts", tmp_path / "c.js"]
        paths[0].write_text("Java.perform(() => {});")
        paths[1].write_text("send('b');")
        paths[2].write_text('import Java from "frida-java-bridge";\nJava.perform(() => {});')
        session, agent = MagicMock(), MagicMock()
        order = []
        agent.exports_sync.load_user_script.side_effect = lambda name, source: order.append(name)
        session.create_script.return_value.load.side_effect = lambda: order.append("b.ts")

        load_user_scripts(session, agent, paths, MagicMock())

        assert order == ["a.js", "b.ts", "c.js"]

    def test_names_the_script_that_fails_to_load(self, tmp_path):
        script_path = tmp_path / "unlock.js"
        script_path.write_text("Java.perform(() => {});")
        agent = MagicMock()
        agent.exports_sync.load_user_script.side_effect = Exception("ReferenceError: foo is not defined")

        with pytest.raises(RuntimeError, match="Failed to load unlock.js: ReferenceError: foo is not defined"):
            load_user_scripts(MagicMock(), agent, [script_path], MagicMock())
