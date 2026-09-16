"""Tests for CLI functionality such as parameter parsing and command validation."""

import argparse
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from frooky.cli import build_parser, main


class TestArgumentParsing:
    """Tests for CLI argument parsing (build_parser)."""

    def test_requires_a_target(self, capsys):
        """One of -F/-n/-N/-p/-f is required."""
        parser = build_parser()
        with pytest.raises(SystemExit) as exc_info:
            parser.parse_args(["hooks.yaml"])

        assert exc_info.value.code == 2
        assert "one of the arguments" in capsys.readouterr().err.lower()

    def test_targets_are_mutually_exclusive(self, capsys):
        parser = build_parser()
        with pytest.raises(SystemExit) as exc_info:
            parser.parse_args(["-F", "-n", "com.example.app", "hooks.yaml"])

        assert exc_info.value.code == 2
        assert "not allowed with" in capsys.readouterr().err.lower()

    def test_hooks_is_required(self, capsys):
        parser = build_parser()
        with pytest.raises(SystemExit) as exc_info:
            parser.parse_args(["-F"])

        assert exc_info.value.code == 2
        assert "hooks" in capsys.readouterr().err.lower()

    def test_minimal_valid_args(self):
        parser = build_parser()
        args = parser.parse_args(["-F", "hooks.yaml"])

        assert args.attach_frontmost is True
        assert args.hooks == ["hooks.yaml"]
        assert args.output == "output.json"
        assert args.print_events is False
        assert args.resolver_timeout == 5
        assert args.user_scripts == []
        assert args.v is False
        assert args.vv is False
        assert args.device is None
        assert args.usb is False
        assert args.remote is False
        assert args.host is None
        assert args.certificate is None

    def test_multiple_hooks_files(self):
        parser = build_parser()
        args = parser.parse_args(["-F", "a.yaml", "b.yaml"])

        assert args.hooks == ["a.yaml", "b.yaml"]

    def test_load_can_be_repeated(self):
        parser = build_parser()
        args = parser.parse_args(["-F", "-l", "one.js", "-l", "two.js", "hooks.yaml"])

        assert args.user_scripts == ["one.js", "two.js"]

    def test_resolver_timeout_is_parsed_as_int(self):
        parser = build_parser()
        args = parser.parse_args(["-F", "-t", "10", "hooks.yaml"])

        assert args.resolver_timeout == 10
        assert isinstance(args.resolver_timeout, int)

    def test_resolver_timeout_rejects_non_integer(self, capsys):
        parser = build_parser()
        with pytest.raises(SystemExit) as exc_info:
            parser.parse_args(["-F", "-t", "not-a-number", "hooks.yaml"])

        assert exc_info.value.code == 2
        assert "resolver-timeout" in capsys.readouterr().err.lower()

    def test_attach_pid_is_parsed_as_int(self):
        parser = build_parser()
        args = parser.parse_args(["-p", "1234", "hooks.yaml"])

        assert args.attach_pid == 1234
        assert isinstance(args.attach_pid, int)

    def test_attach_name(self):
        parser = build_parser()
        args = parser.parse_args(["-n", "com.example.app", "hooks.yaml"])

        assert args.attach_name == "com.example.app"

    def test_attach_identifier(self):
        parser = build_parser()
        args = parser.parse_args(["-N", "com.example.app", "hooks.yaml"])

        assert args.attach_identifier == "com.example.app"

    def test_spawn_target(self):
        parser = build_parser()
        args = parser.parse_args(["-f", "/path/to/app", "hooks.yaml"])

        assert args.spawn == "/path/to/app"

    def test_verbose_flags(self):
        parser = build_parser()
        args = parser.parse_args(["-F", "-v", "-vv", "hooks.yaml"])

        assert args.v is True
        assert args.vv is True

    def test_print_events_flag(self):
        parser = build_parser()
        args = parser.parse_args(["-F", "-e", "hooks.yaml"])

        assert args.print_events is True

    def test_output_override(self):
        parser = build_parser()
        args = parser.parse_args(["-F", "-o", "custom.ndjson", "hooks.yaml"])

        assert args.output == "custom.ndjson"

    def test_device_selection_flags(self):
        parser = build_parser()
        args = parser.parse_args(["-F", "-D", "emulator-5554", "--certificate", "cert.pem", "hooks.yaml"])

        assert args.device == "emulator-5554"
        assert args.certificate == "cert.pem"

    def test_version(self, capsys):
        parser = build_parser()
        with pytest.raises(SystemExit) as exc_info:
            parser.parse_args(["--version"])

        assert exc_info.value.code == 0
        assert "frooky" in capsys.readouterr().out.lower()


@pytest.fixture
def stub_runner(monkeypatch):
    """Replace FrookyRunner so main() never touches Frida, and capture the options it received."""
    mock_cls = MagicMock()
    mock_cls.return_value.run.return_value = 0
    monkeypatch.setattr("frooky.cli.FrookyRunner", mock_cls)
    return mock_cls


class TestMain:
    """Tests for main()'s validation logic and option wiring."""

    def test_no_args_prints_help_and_exits(self, monkeypatch, capsys):
        monkeypatch.setattr("sys.argv", ["frooky"])

        with pytest.raises(SystemExit) as exc_info:
            main()

        assert exc_info.value.code == 1
        assert "usage" in capsys.readouterr().out.lower()

    def test_rejects_non_positive_resolver_timeout(self, monkeypatch, tmp_path):
        hooks_file = tmp_path / "hooks.yaml"
        hooks_file.write_text("category: TEST\nhooks: []\n")
        monkeypatch.setattr("sys.argv", ["frooky", "-F", "-t", "0", str(hooks_file)])

        with pytest.raises(argparse.ArgumentTypeError, match="resolver-timeout"):
            main()

    def test_rejects_multiple_device_selectors(self, monkeypatch, tmp_path, capsys):
        hooks_file = tmp_path / "hooks.yaml"
        hooks_file.write_text("category: TEST\nhooks: []\n")
        monkeypatch.setattr("sys.argv", ["frooky", "-F", "-U", "-D", "some-device", str(hooks_file)])

        with pytest.raises(SystemExit) as exc_info:
            main()

        assert exc_info.value.code == 2
        assert "-D/--device" in capsys.readouterr().err

    def test_missing_hooks_file_errors(self, monkeypatch, tmp_path, capsys):
        missing = tmp_path / "does-not-exist.yaml"
        monkeypatch.setattr("sys.argv", ["frooky", "-F", str(missing)])

        with pytest.raises(SystemExit) as exc_info:
            main()

        assert exc_info.value.code == 2
        assert "hooks file not found" in capsys.readouterr().err.lower()

    def test_missing_user_script_errors(self, monkeypatch, tmp_path, capsys):
        hooks_file = tmp_path / "hooks.yaml"
        hooks_file.write_text("category: TEST\nhooks: []\n")
        missing_script = tmp_path / "missing.js"
        monkeypatch.setattr("sys.argv", ["frooky", "-F", "-l", str(missing_script), str(hooks_file)])

        with pytest.raises(SystemExit) as exc_info:
            main()

        assert exc_info.value.code == 2
        assert "script file not found" in capsys.readouterr().err.lower()

    def test_missing_agent_dist_exits(self, monkeypatch, tmp_path, capsys):
        hooks_file = tmp_path / "hooks.yaml"
        hooks_file.write_text("category: TEST\nhooks: []\n")
        monkeypatch.setattr("sys.argv", ["frooky", "-F", str(hooks_file)])
        monkeypatch.setattr("frooky.cli.files", lambda _pkg: tmp_path / "no-such-package")

        with pytest.raises(SystemExit) as exc_info:
            main()

        assert exc_info.value.code == 1
        assert "frooky agent not found" in capsys.readouterr().err.lower()

    def test_builds_options_and_runs(self, monkeypatch, tmp_path, stub_runner):
        hooks_file = tmp_path / "hooks.yaml"
        hooks_file.write_text("category: TEST\nhooks: []\n")
        script_file = tmp_path / "script.js"
        script_file.write_text("console.log('hi')")
        output_path = tmp_path / "out.json"

        monkeypatch.setattr(
            "sys.argv",
            [
                "frooky",
                "-p",
                "4321",
                "-l",
                str(script_file),
                "-o",
                str(output_path),
                "-t",
                "9",
                "-e",
                str(hooks_file),
            ],
        )

        result = main()

        assert result == 0
        stub_runner.assert_called_once()
        options = stub_runner.call_args.args[0]
        assert options.hook_paths == [hooks_file.resolve()]
        assert options.user_scripts == [script_file.resolve()]
        assert options.output_path == Path(str(output_path))
        assert options.attach_pid == 4321
        assert options.agent_option_resolver_timeout == 9
        assert options.print_events is True
        stub_runner.return_value.run.assert_called_once()
