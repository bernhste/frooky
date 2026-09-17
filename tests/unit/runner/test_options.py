"""Unit tests for RunnerOptions."""

from pathlib import Path

from frooky.runner import RunnerOptions


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
