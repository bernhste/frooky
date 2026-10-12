"""Unit tests for hook config and user script loading."""

import json
from pathlib import Path
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

    def test_reads_only_true_and_false_as_booleans(self, tmp_path):
        hook_file = tmp_path / "hooks.yaml"
        hook_file.write_text(
            "hookSettings: { javaStackTrace: true, nativeStackTrace: False, early: TRUE }\n"
            "hookCollections:\n"
            "  - javaClass: a.b\n"
            "    hooks:\n"
            "      - on\n"
            "      - no\n"
            "      - method: yes\n"
            "        overloads:\n"
            "          - params:\n"
            '              - ["[B", b, { offset: off, length: y }]\n'
            "              - [int, off]\n"
            "              - [int, y]\n"
        )

        [config] = load_hook_configs([hook_file])

        assert config["hookSettings"] == {"javaStackTrace": True, "nativeStackTrace": False, "early": True}
        [collection] = config["hookCollections"]
        assert collection["hooks"][:2] == ["on", "no"]
        assert collection["hooks"][2]["method"] == "yes"
        assert collection["hooks"][2]["overloads"][0]["params"] == [["[B", "b", {"offset": "off", "length": "y"}], ["int", "off"], ["int", "y"]]

    def test_reads_numbers_as_yaml_1_2_does(self, tmp_path):
        hook_file = tmp_path / "hooks.yaml"
        hook_file.write_text("hex: 0x1A2b4\noctal: 0o17\nleading_zero: 012\nnegative: -5\nplus: +5\nzero: 0\nfloat: 1.5\nexponent: 1e3\ndot: .5\nquoted: '0x10'\nunderscore: 1_000\nsexagesimal: 1:30\ndate: 2026-01-01\nnull_value: null\ntilde: ~\n")

        [config] = load_hook_configs([hook_file])

        assert config == {
            "hex": 0x1A2B4,
            "octal": 15,
            "leading_zero": 12,
            "negative": -5,
            "plus": 5,
            "zero": 0,
            "float": 1.5,
            "exponent": 1000.0,
            "dot": 0.5,
            "quoted": "0x10",
            "underscore": "1_000",
            "sexagesimal": "1:30",
            "date": "2026-01-01",
            "null_value": None,
            "tilde": None,
        }
        assert all(type(config[key]) is int for key in ("hex", "octal", "leading_zero", "negative", "plus", "zero"))

    def test_loads_the_examples_like_the_schema_validator(self):
        """Every example loads to JSON-serializable values, as the schema validator's YAML 1.2 parser reads it."""
        examples = sorted((Path(__file__).parents[4] / "docs" / "examples").rglob("*.yaml"))

        assert examples
        for config in load_hook_configs(examples):
            json.dumps(config)

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

    def test_compiles_javascript_with_named_import(self, tmp_path):
        js_file = tmp_path / "unlock.js"
        js_file.write_text('import { Java, perform } from "frida-java-bridge";\nperform(() => {});')

        compiled = compile_user_script(js_file)

        assert '__require("frida-java-bridge")' in compiled
        assert "import {" not in compiled

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
            'const { Java, perform } = require("frida-java-bridge");',
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
