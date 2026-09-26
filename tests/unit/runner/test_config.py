"""Unit tests for hook config and user script loading."""

import json
from unittest.mock import MagicMock

from frooky.runner.config import load_hook_configs, load_user_scripts


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

    def test_loads_deprecated_json_file_and_warns(self, tmp_path, caplog):
        hook_file = tmp_path / "hooks.json"
        hook_file.write_text(json.dumps({"category": "STORAGE", "hooks": []}))

        with caplog.at_level("WARNING"):
            targets = load_hook_configs([hook_file])

        assert targets == [{"category": "STORAGE", "hooks": []}]
        assert "deprecated" in caplog.text.lower()


class TestLoadUserScripts:
    def test_loads_and_tracks_each_script(self, tmp_path):
        script_path = tmp_path / "script.js"
        script_path.write_text("console.log('hi')")
        session = MagicMock()
        script_mock = session.create_script.return_value

        scripts = load_user_scripts(session, [script_path], MagicMock())

        session.create_script.assert_called_once_with("console.log('hi')")
        script_mock.set_log_handler.assert_called_once()
        script_mock.load.assert_called_once()
        assert scripts == [script_mock]
