"""Unit tests for Frida device selection, platform detection, and target attach/spawn."""

from unittest.mock import MagicMock

import pytest

from frooky.runner.device import attach_or_spawn, describe_target, detect_platform
from frooky.runner.options import RunnerOptions


def make_options(**overrides) -> RunnerOptions:
    defaults = {"hook_paths": [], "output_path": "out.json"}
    defaults.update(overrides)
    return RunnerOptions(**defaults)


class TestDescribeTarget:
    def test_attach_name(self):
        options = make_options(attach_name="com.example.app")
        assert describe_target(MagicMock(), options) == "com.example.app"

    def test_attach_identifier(self):
        options = make_options(attach_identifier="com.example.app")
        assert describe_target(MagicMock(), options) == "com.example.app"

    def test_attach_pid(self):
        options = make_options(attach_pid=1234)
        assert describe_target(MagicMock(), options) == "1234"

    def test_spawn(self):
        options = make_options(spawn="/path/to/app")
        assert describe_target(MagicMock(), options) == "/path/to/app (spawned)"

    def test_unknown_target(self):
        options = make_options()
        assert describe_target(MagicMock(), options) == "unknown target"

    def test_attach_frontmost_with_app(self):
        options = make_options(attach_frontmost=True)
        device = MagicMock()
        app = MagicMock(pid=42)
        app.name = "Foo"
        device.get_frontmost_application.return_value = app

        assert describe_target(device, options) == "frontmost application: Foo (PID: 42)"

    def test_attach_frontmost_without_app(self):
        options = make_options(attach_frontmost=True)
        device = MagicMock()
        device.get_frontmost_application.return_value = None

        assert describe_target(device, options) == "frontmost application"


class TestDetectPlatform:
    def test_android(self):
        device = MagicMock()
        device.query_system_parameters.return_value = {"os": {"id": "android"}}

        assert detect_platform(device) == "android"

    def test_ios(self):
        device = MagicMock()
        device.query_system_parameters.return_value = {"os": {"id": "ios"}}

        assert detect_platform(device) == "ios"

    def test_unsupported_platform_raises(self):
        device = MagicMock()
        device.query_system_parameters.return_value = {"os": {"id": "windows"}}

        with pytest.raises(RuntimeError, match="windows"):
            detect_platform(device)


class TestAttachOrSpawn:
    def test_attach_frontmost(self):
        options = make_options(attach_frontmost=True)
        device = MagicMock()
        device.get_frontmost_application.return_value = MagicMock(pid=42)
        session = device.attach.return_value

        result_session, spawned_pid = attach_or_spawn(device, options)

        assert result_session is session
        assert spawned_pid is None
        device.attach.assert_called_once_with(42)

    def test_attach_frontmost_none_found_raises(self):
        options = make_options(attach_frontmost=True)
        device = MagicMock()
        device.get_frontmost_application.return_value = None

        with pytest.raises(RuntimeError, match="No frontmost application"):
            attach_or_spawn(device, options)

    def test_attach_name(self):
        options = make_options(attach_name="com.example.app")
        device = MagicMock()
        session = device.attach.return_value

        result_session, spawned_pid = attach_or_spawn(device, options)

        assert result_session is session
        assert spawned_pid is None
        device.attach.assert_called_once_with("com.example.app")

    def test_attach_identifier_matches_running_process(self):
        options = make_options(attach_identifier="com.example.app")
        device = MagicMock()
        matching = MagicMock(identifier="com.example.app", pid=99)
        other = MagicMock(identifier="com.other.app", pid=1)
        device.enumerate_processes.return_value = [other, matching]

        attach_or_spawn(device, options)

        device.attach.assert_called_once_with(99)

    def test_attach_identifier_falls_back_when_not_running(self):
        options = make_options(attach_identifier="com.example.app")
        device = MagicMock()
        device.enumerate_processes.return_value = []

        attach_or_spawn(device, options)

        device.attach.assert_called_once_with("com.example.app")

    def test_attach_pid(self):
        options = make_options(attach_pid=4321)
        device = MagicMock()

        attach_or_spawn(device, options)

        device.attach.assert_called_once_with(4321)

    def test_spawn(self):
        options = make_options(spawn="/path/to/app")
        device = MagicMock()
        device.spawn.return_value = 555

        session, spawned_pid = attach_or_spawn(device, options)

        device.spawn.assert_called_once_with("/path/to/app")
        device.attach.assert_called_once_with(555)
        assert spawned_pid == 555
        assert session is device.attach.return_value

    def test_no_target_raises(self):
        options = make_options()
        device = MagicMock()

        with pytest.raises(RuntimeError, match="No target specified"):
            attach_or_spawn(device, options)
