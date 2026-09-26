"""Unit tests for the FrookyRunner orchestrator's non-Frida wiring."""

import os
from unittest.mock import MagicMock

from frooky.runner import FrookyRunner, RunnerOptions


def make_runner(tmp_path, **overrides) -> FrookyRunner:
    defaults = {"hook_paths": [], "output_path": tmp_path / "output.json"}
    defaults.update(overrides)
    return FrookyRunner(RunnerOptions(**defaults))


class TestFrookyRunnerInit:
    def test_wires_output_writer_to_options_output_path(self, tmp_path):
        runner = make_runner(tmp_path)
        try:
            assert runner.output.output_path == tmp_path / "output.json"
            assert runner.output.event_count == 0
        finally:
            runner._stop_live_terminal()

    def test_stop_live_terminal_does_not_raise(self, tmp_path):
        runner = make_runner(tmp_path)
        runner._stop_live_terminal()


class TestUpdateStatusLine:
    def test_truncates_long_last_event(self, tmp_path):
        runner = make_runner(tmp_path)
        try:
            runner.output.last_event = "x" * 100
            runner.output.event_count = 3
            runner._live.update = MagicMock()

            runner._update_status_line()

            rendered_text = runner._live.update.call_args.args[0]
            assert "Events: 3" in rendered_text.plain
            assert "..." in rendered_text.plain
        finally:
            runner._stop_live_terminal()


class TestOnSessionDetached:
    def test_sets_stop_reason_and_event(self, tmp_path):
        runner = make_runner(tmp_path)
        try:
            runner._on_session_detached("process-terminated", None)

            assert runner._stop_reason == "process-terminated"
            assert runner._stop_event.is_set()
        finally:
            runner._stop_live_terminal()

    def test_first_call_wins(self, tmp_path):
        runner = make_runner(tmp_path)
        try:
            runner._on_session_detached("device-lost", None)
            runner._on_session_detached("application-requested", None)

            assert runner._stop_reason == "device-lost"
        finally:
            runner._stop_live_terminal()


class TestDescribeStopReason:
    def test_no_reason_yet(self, tmp_path):
        runner = make_runner(tmp_path)
        try:
            assert runner._describe_stop_reason() == "stopped"
        finally:
            runner._stop_live_terminal()

    def test_user_interrupt(self, tmp_path):
        runner = make_runner(tmp_path)
        try:
            runner._stop_reason = "user interrupt"
            assert runner._describe_stop_reason() == "stopped by user (Ctrl+C)"
        finally:
            runner._stop_live_terminal()

    def test_frida_reason_is_humanized(self, tmp_path):
        runner = make_runner(tmp_path)
        try:
            runner._stop_reason = "process-terminated"
            assert runner._describe_stop_reason() == "Process terminated"
        finally:
            runner._stop_live_terminal()

    def test_crash_takes_priority_and_includes_summary(self, tmp_path):
        runner = make_runner(tmp_path)
        try:
            runner._stop_reason = "process-terminated"
            runner._crash = MagicMock(summary="native crash in libfoo.so")

            assert runner._describe_stop_reason() == "process crashed (native crash in libfoo.so)"
        finally:
            runner._stop_live_terminal()


class TestExitCodeForStopReason:
    def test_none_is_success(self, tmp_path):
        runner = make_runner(tmp_path)
        try:
            assert runner._exit_code_for_stop_reason() == 0
        finally:
            runner._stop_live_terminal()

    def test_user_interrupt_is_success(self, tmp_path):
        runner = make_runner(tmp_path)
        try:
            runner._stop_reason = "user interrupt"
            assert runner._exit_code_for_stop_reason() == 0
        finally:
            runner._stop_live_terminal()

    def test_lost_connection_is_failure(self, tmp_path):
        runner = make_runner(tmp_path)
        try:
            runner._stop_reason = "device-lost"
            assert runner._exit_code_for_stop_reason() == 1
        finally:
            runner._stop_live_terminal()


class TestPrintSummary:
    def test_reports_event_count_and_output_path(self, tmp_path, capsys):
        runner = make_runner(tmp_path)
        try:
            runner.output.event_count = 5
            runner._stop_reason = "process-terminated"

            runner._print_summary()

            out = capsys.readouterr().out
            assert "Stopped: Process terminated" in out
            assert "Events captured: 5" in out
            assert str(runner.options.output_path) in out
        finally:
            runner._stop_live_terminal()


class TestRunSessionLoss:
    """Exercises run()'s main loop with Frida device/session interactions mocked out."""

    def _make_wired_runner(self, monkeypatch, tmp_path, **option_overrides):
        hook_file = tmp_path / "hooks.yaml"
        hook_file.write_text("category: TEST\nhooks: []\n")

        device = MagicMock()
        device.name = "Test Device"
        device.id = "test-device"
        session = MagicMock()
        session.create_script.return_value = MagicMock()

        monkeypatch.setattr("frooky.runner.runner.get_device", lambda options: device)
        monkeypatch.setattr("frooky.runner.runner.detect_platform", lambda d: "android")
        monkeypatch.setattr("frooky.runner.runner.attach_or_spawn", lambda d, o: (session, None))
        monkeypatch.setattr("frooky.runner.runner.get_device_frida_version", lambda s: "16.0.0")
        monkeypatch.setattr("frooky.runner.runner.load_user_scripts", lambda s, paths: [])
        monkeypatch.setattr("frooky.runner.runner.load_hook_configs", lambda paths: [])

        defaults = {"hook_paths": [hook_file], "output_path": tmp_path / "out.json", "attach_pid": 1234}
        defaults.update(option_overrides)
        runner = FrookyRunner(RunnerOptions(**defaults))
        return runner, session

    def test_exits_gracefully_when_session_detaches(self, monkeypatch, tmp_path, capsys):
        runner, session = self._make_wired_runner(monkeypatch, tmp_path)

        def fake_sleep(seconds):
            runner._on_session_detached("process-terminated", None)

        monkeypatch.setattr("frooky.runner.runner.time.sleep", fake_sleep)

        exit_code = runner.run()

        session.on.assert_any_call("detached", runner._on_session_detached)
        assert exit_code == 1
        assert "Stopped: Process terminated" in capsys.readouterr().out

    def test_exits_cleanly_on_keyboard_interrupt(self, monkeypatch, tmp_path, capsys):
        runner, _session = self._make_wired_runner(monkeypatch, tmp_path)

        def fake_sleep(seconds):
            raise KeyboardInterrupt

        monkeypatch.setattr("frooky.runner.runner.time.sleep", fake_sleep)

        exit_code = runner.run()

        assert exit_code == 0
        assert "Stopped: stopped by user (Ctrl+C)" in capsys.readouterr().out


class TestRunWatch:
    """run() with --watch: changed hook files are sent to the agent while running."""

    def _make_wired_runner(self, monkeypatch, tmp_path, watch):
        hook_file = tmp_path / "hooks.yaml"
        hook_file.write_text("hookCollection: []\n")

        device = MagicMock()
        device.name = "Test Device"
        device.id = "test-device"
        session = MagicMock()
        script = MagicMock()
        session.create_script.return_value = script

        monkeypatch.setattr("frooky.runner.runner.get_device", lambda options: device)
        monkeypatch.setattr("frooky.runner.runner.detect_platform", lambda d: "android")
        monkeypatch.setattr("frooky.runner.runner.attach_or_spawn", lambda d, o: (session, None))
        monkeypatch.setattr("frooky.runner.runner.get_device_frida_version", lambda s: "16.0.0")
        monkeypatch.setattr("frooky.runner.runner.load_user_scripts", lambda s, paths: [])

        runner = FrookyRunner(RunnerOptions(hook_paths=[hook_file], output_path=tmp_path / "out.json", attach_pid=1234, watch=watch))
        return runner, script, hook_file

    def _run_editing(self, monkeypatch, runner, edits):
        """Run the main loop, applying one edit per loop tick, then stop."""
        pending = list(edits)

        def fake_sleep(seconds):
            if not pending:
                raise KeyboardInterrupt
            pending.pop(0)()

        monkeypatch.setattr("frooky.runner.runner.time.sleep", fake_sleep)
        return runner.run()

    def test_loads_configs_with_their_file_paths_as_ids(self, monkeypatch, tmp_path):
        runner, script, hook_file = self._make_wired_runner(monkeypatch, tmp_path, watch=False)

        self._run_editing(monkeypatch, runner, [])

        script.exports_sync.load_frooky_configs.assert_called_once_with([{"hookCollection": []}], [str(hook_file)])

    def test_sends_changed_hook_file_to_agent(self, monkeypatch, tmp_path):
        runner, script, hook_file = self._make_wired_runner(monkeypatch, tmp_path, watch=True)
        new_content = "hookCollection:\n  - module: libc.so\n    hooks: [open]\n"

        exit_code = self._run_editing(monkeypatch, runner, [lambda: _rewrite(hook_file, new_content)])

        assert exit_code == 0
        script.exports_sync.update_frooky_config.assert_called_once_with(str(hook_file), {"hookCollection": [{"module": "libc.so", "hooks": ["open"]}]})

    def test_r_reloads_every_hook_file_and_retries_failed_hooks(self, monkeypatch, tmp_path):
        runner, script, hook_file = self._make_wired_runner(monkeypatch, tmp_path, watch=True)

        self._run_editing(monkeypatch, runner, [lambda: runner._on_key("r")])

        script.exports_sync.update_frooky_config.assert_called_once_with(str(hook_file), {"hookCollection": []}, True)

    def test_r_picks_up_file_changes_without_watch(self, monkeypatch, tmp_path):
        runner, script, hook_file = self._make_wired_runner(monkeypatch, tmp_path, watch=False)
        new_content = "hookCollection:\n  - module: libc.so\n    hooks: [open]\n"

        def edit_and_press_r():
            _rewrite(hook_file, new_content)
            runner._on_key("R")

        self._run_editing(monkeypatch, runner, [edit_and_press_r])

        script.exports_sync.update_frooky_config.assert_called_once_with(str(hook_file), {"hookCollection": [{"module": "libc.so", "hooks": ["open"]}]}, True)

    def test_r_keeps_previous_version_when_hook_file_is_broken(self, monkeypatch, tmp_path, capsys):
        runner, script, hook_file = self._make_wired_runner(monkeypatch, tmp_path, watch=False)

        def break_and_press_r():
            _rewrite(hook_file, "hookCollection: [\n")
            runner._on_key("r")

        self._run_editing(monkeypatch, runner, [break_and_press_r])

        script.exports_sync.update_frooky_config.assert_not_called()
        assert "Not reloaded hooks.yaml, keeping the previous version" in capsys.readouterr().err

    def test_ignores_other_keys(self, monkeypatch, tmp_path):
        runner, script, _hook_file = self._make_wired_runner(monkeypatch, tmp_path, watch=True)

        self._run_editing(monkeypatch, runner, [lambda: runner._on_key("x")])

        script.exports_sync.update_frooky_config.assert_not_called()

    def test_does_not_watch_without_flag(self, monkeypatch, tmp_path):
        runner, script, hook_file = self._make_wired_runner(monkeypatch, tmp_path, watch=False)

        self._run_editing(monkeypatch, runner, [lambda: _rewrite(hook_file, "hookCollection: [{module: x, hooks: [y]}]\n")])

        script.exports_sync.update_frooky_config.assert_not_called()


def _rewrite(path, content):
    """Write new content and bump the mtime, which a same-tick rewrite might otherwise not change."""
    path.write_text(content)
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))
