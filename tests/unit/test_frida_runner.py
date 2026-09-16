"""Unit tests for the pure-Python parts of FrookyRunner (no real Frida device/session)."""

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from frooky.frida_runner import FrookyRunner, RunnerOptions


@pytest.fixture
def make_runner(tmp_path):
    """Build a FrookyRunner without touching Frida, and stop its Live console afterwards."""
    runners = []

    def _make(**overrides):
        defaults = {"hook_paths": [], "output_path": tmp_path / "output.json"}
        defaults.update(overrides)
        runner = FrookyRunner(RunnerOptions(**defaults))
        runners.append(runner)
        return runner

    yield _make

    for runner in runners:
        runner._stop_live_terminal()


class TestRunnerOptions:
    def test_defaults(self, tmp_path):
        options = RunnerOptions(hook_paths=[tmp_path / "a.yaml"], output_path=tmp_path / "out.json")

        assert options.device_id is None
        assert options.use_usb is False
        assert options.remote is False
        assert options.host is None
        assert options.certificate is None
        assert options.attach_frontmost is False
        assert options.attach_name is None
        assert options.attach_identifier is None
        assert options.attach_pid is None
        assert options.spawn is None
        assert options.user_scripts == []
        assert options.agent_option_verbose is False
        assert options.agent_option_very_verbose is False
        assert options.agent_option_resolver_timeout is None
        assert options.print_events is False

    def test_user_scripts_default_is_not_shared_between_instances(self, tmp_path):
        a = RunnerOptions(hook_paths=[], output_path=tmp_path / "out.json")
        b = RunnerOptions(hook_paths=[], output_path=tmp_path / "out.json")

        a.user_scripts.append(Path("script.js"))

        assert b.user_scripts == []


class TestPrepareTargets:
    def test_loads_single_yaml_file(self, make_runner, tmp_path):
        hook_file = tmp_path / "hooks.yaml"
        hook_file.write_text("category: STORAGE\nhooks:\n  - class: com.example.Foo\n    methods: [bar]\n")
        runner = make_runner(hook_paths=[hook_file])

        targets = runner._prepare_targets()

        assert targets == [{"category": "STORAGE", "hooks": [{"class": "com.example.Foo", "methods": ["bar"]}]}]

    def test_loads_multiple_files_preserving_order(self, make_runner, tmp_path):
        first = tmp_path / "first.yaml"
        first.write_text("category: A\nhooks: []\n")
        second = tmp_path / "second.yml"
        second.write_text("category: B\nhooks: []\n")
        runner = make_runner(hook_paths=[first, second])

        targets = runner._prepare_targets()

        assert [t["category"] for t in targets] == ["A", "B"]

    def test_loads_deprecated_json_file_and_warns(self, make_runner, tmp_path, caplog):
        hook_file = tmp_path / "hooks.json"
        hook_file.write_text(json.dumps({"category": "STORAGE", "hooks": []}))
        runner = make_runner(hook_paths=[hook_file])

        with caplog.at_level("WARNING"):
            targets = runner._prepare_targets()

        assert targets == [{"category": "STORAGE", "hooks": []}]
        assert "deprecated" in caplog.text.lower()


class TestGetTargetDescription:
    def test_attach_name(self, make_runner):
        runner = make_runner(attach_name="com.example.app")
        assert runner._get_target_description() == "com.example.app"

    def test_attach_identifier(self, make_runner):
        runner = make_runner(attach_identifier="com.example.app")
        assert runner._get_target_description() == "com.example.app"

    def test_attach_pid(self, make_runner):
        runner = make_runner(attach_pid=1234)
        assert runner._get_target_description() == "1234"

    def test_spawn(self, make_runner):
        runner = make_runner(spawn="/path/to/app")
        assert runner._get_target_description() == "/path/to/app (spawned)"

    def test_unknown_target(self, make_runner):
        runner = make_runner()
        assert runner._get_target_description() == "unknown target"

    def test_attach_frontmost_with_app(self, make_runner):
        runner = make_runner(attach_frontmost=True)
        runner.device = MagicMock()
        app = MagicMock(pid=42)
        app.name = "Foo"
        runner.device.get_frontmost_application.return_value = app

        assert runner._get_target_description() == "frontmost application: Foo (PID: 42)"

    def test_attach_frontmost_without_app(self, make_runner):
        runner = make_runner(attach_frontmost=True)
        runner.device = MagicMock()
        runner.device.get_frontmost_application.return_value = None

        assert runner._get_target_description() == "frontmost application"


class TestDetectPlatform:
    def test_android(self, make_runner):
        runner = make_runner()
        runner.device = MagicMock()
        runner.device.query_system_parameters.return_value = {"os": {"id": "android"}}

        assert runner._detect_platform() == "android"

    def test_ios(self, make_runner):
        runner = make_runner()
        runner.device = MagicMock()
        runner.device.query_system_parameters.return_value = {"os": {"id": "ios"}}

        assert runner._detect_platform() == "ios"

    def test_unsupported_platform_raises(self, make_runner):
        runner = make_runner()
        runner.device = MagicMock()
        runner.device.query_system_parameters.return_value = {"os": {"id": "windows"}}

        with pytest.raises(RuntimeError, match="windows"):
            runner._detect_platform()


class TestAttachOrSpawn:
    def test_attach_frontmost(self, make_runner):
        runner = make_runner(attach_frontmost=True)
        runner.device = MagicMock()
        runner.device.get_frontmost_application.return_value = MagicMock(pid=42)
        session = runner.device.attach.return_value

        assert runner._attach_or_spawn() is session
        runner.device.attach.assert_called_once_with(42)

    def test_attach_frontmost_none_found_raises(self, make_runner):
        runner = make_runner(attach_frontmost=True)
        runner.device = MagicMock()
        runner.device.get_frontmost_application.return_value = None

        with pytest.raises(RuntimeError, match="No frontmost application"):
            runner._attach_or_spawn()

    def test_attach_name(self, make_runner):
        runner = make_runner(attach_name="com.example.app")
        runner.device = MagicMock()
        session = runner.device.attach.return_value

        assert runner._attach_or_spawn() is session
        runner.device.attach.assert_called_once_with("com.example.app")

    def test_attach_identifier_matches_running_process(self, make_runner):
        runner = make_runner(attach_identifier="com.example.app")
        runner.device = MagicMock()
        matching = MagicMock(identifier="com.example.app", pid=99)
        other = MagicMock(identifier="com.other.app", pid=1)
        runner.device.enumerate_processes.return_value = [other, matching]

        runner._attach_or_spawn()

        runner.device.attach.assert_called_once_with(99)

    def test_attach_identifier_falls_back_when_not_running(self, make_runner):
        runner = make_runner(attach_identifier="com.example.app")
        runner.device = MagicMock()
        runner.device.enumerate_processes.return_value = []

        runner._attach_or_spawn()

        runner.device.attach.assert_called_once_with("com.example.app")

    def test_attach_pid(self, make_runner):
        runner = make_runner(attach_pid=4321)
        runner.device = MagicMock()

        runner._attach_or_spawn()

        runner.device.attach.assert_called_once_with(4321)

    def test_spawn(self, make_runner):
        runner = make_runner(spawn="/path/to/app")
        runner.device = MagicMock()
        runner.device.spawn.return_value = 555

        runner._attach_or_spawn()

        runner.device.spawn.assert_called_once_with("/path/to/app")
        runner.device.attach.assert_called_once_with(555)
        assert runner.spawned_pid == 555

    def test_no_target_raises(self, make_runner):
        runner = make_runner()
        runner.device = MagicMock()

        with pytest.raises(RuntimeError, match="No target specified"):
            runner._attach_or_spawn()


class TestLoadUserScripts:
    def test_loads_and_tracks_each_script(self, make_runner, tmp_path):
        script_path = tmp_path / "script.js"
        script_path.write_text("console.log('hi')")
        runner = make_runner(user_scripts=[script_path])
        runner.session = MagicMock()
        script_mock = runner.session.create_script.return_value

        runner._load_user_scripts()

        runner.session.create_script.assert_called_once_with("console.log('hi')")
        script_mock.load.assert_called_once()
        assert runner.user_scripts == [script_mock]


class TestMessageHandler:
    def test_ignores_non_send_messages(self, make_runner, capsys):
        runner = make_runner()
        on_message = runner._create_message_handler()

        on_message({"type": "error", "description": "boom"}, None)

        assert "boom" in capsys.readouterr().out
        assert not runner.options.output_path.exists()

    def test_writes_list_payload_and_updates_status_from_native_symbol(self, make_runner):
        runner = make_runner()
        on_message = runner._create_message_handler()
        payload = [{"module": "libc.so", "symbol": "strcpy"}, {"module": "libc.so", "symbol": "memcpy"}]

        on_message({"type": "send", "payload": payload}, None)

        assert runner.event_count == 2
        assert runner.last_event == "libc.so: memcpy"
        lines = runner.options.output_path.read_text(encoding="utf-8").splitlines()
        assert json.loads(lines[0]) == payload

    def test_writes_list_payload_and_updates_status_from_java_method(self, make_runner):
        runner = make_runner()
        on_message = runner._create_message_handler()
        payload = [{"javaClassName": "com.example.Foo", "method": "bar"}]

        on_message({"type": "send", "payload": payload}, None)

        assert runner.event_count == 1
        assert runner.last_event == "com.example.Foo.bar"

    def test_print_events_invokes_pretty_printer(self, make_runner, monkeypatch):
        pp_mock = MagicMock()
        monkeypatch.setattr("frooky.frida_runner.pp_hook_event", pp_mock)
        runner = make_runner(print_events=True)
        on_message = runner._create_message_handler()
        payload = [{"module": "libc.so", "symbol": "strcpy"}]

        on_message({"type": "send", "payload": payload}, None)

        pp_mock.assert_called_once_with(payload[0])

    def test_string_payload_summary_sets_totals(self, make_runner):
        runner = make_runner()
        on_message = runner._create_message_handler()
        payload = json.dumps({"type": "summary", "totalHooks": 10, "totalErrors": 2})

        on_message({"type": "send", "payload": payload}, None)

        assert runner.total_hooks == 10
        assert runner.total_errors == 2
        assert runner.event_count == 0

    def test_string_payload_hook_event_updates_last_event(self, make_runner):
        runner = make_runner()
        on_message = runner._create_message_handler()
        payload = json.dumps({"type": "hook", "class": "com.example.Foo", "method": "bar"})

        on_message({"type": "send", "payload": payload}, None)

        assert runner.event_count == 1
        assert runner.last_event == "com.example.Foo.bar"

    def test_string_payload_hook_event_without_class_uses_method_only(self, make_runner):
        runner = make_runner()
        on_message = runner._create_message_handler()
        payload = json.dumps({"type": "native-hook", "symbol": "strcpy"})

        on_message({"type": "send", "payload": payload}, None)

        assert runner.last_event == "strcpy"

    def test_malformed_string_payload_is_reported_without_raising(self, make_runner, capsys):
        runner = make_runner()
        on_message = runner._create_message_handler()

        on_message({"type": "send", "payload": "not json"}, None)

        assert "not json" in capsys.readouterr().out
        assert runner.event_count == 0
