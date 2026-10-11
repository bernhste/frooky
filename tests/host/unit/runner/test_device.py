"""Unit tests for Frida device selection, platform detection, and target attach/spawn."""

from unittest.mock import MagicMock

import frida
import pytest

from frooky.runner.device import attach_or_spawn, choose_device, describe_device, describe_target, detect_platform, get_usb_device
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
        device.enumerate_applications.return_value = [other, matching]

        attach_or_spawn(device, options)

        device.attach.assert_called_once_with(99)

    def test_attach_identifier_falls_back_when_not_running(self):
        options = make_options(attach_identifier="com.example.app")
        device = MagicMock()
        not_running = MagicMock(identifier="com.example.app", pid=0)
        device.enumerate_applications.return_value = [not_running]

        attach_or_spawn(device, options)

        device.attach.assert_called_once_with("com.example.app")

    def test_attach_identifier_falls_back_when_not_found(self):
        options = make_options(attach_identifier="com.example.app")
        device = MagicMock()
        device.enumerate_applications.return_value = []

        attach_or_spawn(device, options)

        device.attach.assert_called_once_with("com.example.app")

    def test_attach_identifier_falls_back_on_error(self):
        options = make_options(attach_identifier="com.example.app")
        device = MagicMock()
        device.enumerate_applications.side_effect = RuntimeError("enumerate error")

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


def make_device(device_id: str, device_type: str = "usb") -> MagicMock:
    device = MagicMock(id=device_id, type=device_type)
    device.name = f"Device {device_id}"
    device.query_system_parameters.return_value = {"os": {"id": "android", "name": "Android", "version": "15"}, "api-level": 35}
    return device


class TestDescribeDevice:
    def test_android_version_and_api_level(self):
        assert describe_device(make_device("emulator-5554")) == "Android 15, API 35 (emulator-5554)"

    def test_without_system_parameters(self):
        device = make_device("emulator-5554")
        device.query_system_parameters.side_effect = frida.ServerNotRunningError("unable to connect")

        assert describe_device(device) == "Device emulator-5554 (emulator-5554)"


class TestGetUsbDevice:
    def test_single_usb_device_is_used_without_asking(self, monkeypatch):
        usb = make_device("emulator-5554")
        monkeypatch.setattr("frida.get_usb_device", lambda timeout: usb)
        monkeypatch.setattr("frida.enumerate_devices", lambda: [make_device("local", "local"), usb])

        assert get_usb_device(choose=lambda _: pytest.fail("must not ask")) is usb

    def test_asks_when_several_usb_devices_are_attached(self, monkeypatch):
        first, second = make_device("emulator-5554"), make_device("emulator-5556")
        monkeypatch.setattr("frida.get_usb_device", lambda timeout: first)
        monkeypatch.setattr("frida.enumerate_devices", lambda: [second, make_device("local", "local"), first])
        offered = []

        def choose(devices):
            offered.extend(devices)
            return devices[1]

        assert get_usb_device(choose=choose) is second
        assert offered == [first, second]


class TestChooseDevice:
    @pytest.fixture(autouse=True)
    def tty(self, monkeypatch):
        monkeypatch.setattr("sys.stdin.isatty", lambda: True)

    def test_by_number(self, capsys):
        devices = [make_device("emulator-5554"), make_device("emulator-5556")]

        assert choose_device(devices, prompt=lambda _: "1") is devices[0]
        assert "2) Android 15, API 35 (emulator-5556)" in capsys.readouterr().err

    def test_by_id(self):
        devices = [make_device("emulator-5554"), make_device("emulator-5556")]

        assert choose_device(devices, prompt=lambda _: "emulator-5556") is devices[1]

    def test_asks_again_on_invalid_answer(self):
        devices = [make_device("emulator-5554"), make_device("emulator-5556")]
        answers = iter(["", "3", "foo", "2"])

        assert choose_device(devices, prompt=lambda _: next(answers)) is devices[1]

    def test_end_of_input_raises(self):
        def prompt(_):
            raise EOFError

        with pytest.raises(RuntimeError, match="No device chosen"):
            choose_device([make_device("a"), make_device("b")], prompt=prompt)

    def test_without_terminal_lists_devices_and_raises(self, monkeypatch):
        monkeypatch.setattr("sys.stdin.isatty", lambda: False)

        with pytest.raises(RuntimeError, match="-s/-D") as exc_info:
            choose_device([make_device("emulator-5554"), make_device("emulator-5556")], prompt=lambda _: pytest.fail("must not ask"))
        assert "emulator-5556" in str(exc_info.value)
