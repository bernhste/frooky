from __future__ import annotations

import os
import signal
import subprocess
import textwrap
import threading
import time
from pathlib import Path

import frida
import pytest

FROOKY_WORKING_DIR = Path(__file__).parent.parent
TARGET_APP = "value_passing_java.frooky.target.app"
MAIN_ACTIVITY = "org.owasp.mastestapp.MainActivity"


@pytest.fixture(params=["android"])
def platform(request):
    """Override conftest platform fixture to only test android."""
    return request.param


@pytest.fixture
def running_app():
    """Ensure TARGET_APP is running on the Android device and return its Frida Application."""
    device = frida.get_usb_device()
    for app in device.enumerate_applications():
        if app.identifier == TARGET_APP and app.pid != 0:
            return app

    subprocess.run(
        ["adb", "shell", "am", "start", "-W", "-n", f"{TARGET_APP}/{MAIN_ACTIVITY}"],
        check=True,
        capture_output=True,
    )
    for _ in range(20):
        time.sleep(0.5)
        for app in device.enumerate_applications():
            if app.identifier == TARGET_APP and app.pid != 0:
                return app
    pytest.fail(f"Could not launch {TARGET_APP} on device")


@pytest.fixture
def hook_file(tmp_path):
    """Provide a minimal valid hook file targeting a standard runtime class."""
    hook_yaml = textwrap.dedent("""\
        hookCollection:
          - javaClass: java.security.MessageDigest
            hooks:
              - getInstance
        """)
    hook_path = tmp_path / "hooks.yaml"
    hook_path.write_text(hook_yaml, encoding="utf-8")
    return hook_path


def run_frooky(args: list[str], timeout: float = 10.0) -> tuple[str, str, int]:
    """Run frooky with CLI arguments, wait for hooks ready or exit, and stop via SIGINT."""
    process = subprocess.Popen(
        ["frooky", *args],
        cwd=FROOKY_WORKING_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )

    chunks: list[str] = []

    def _pump():
        for chunk in iter(lambda: process.stdout.read1(4096), b""):
            chunks.append(chunk.decode("utf-8", errors="replace"))

    pump_thread = threading.Thread(target=_pump, daemon=True)
    pump_thread.start()

    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if process.poll() is not None:
            break
        if "Hooks ready:" in "".join(chunks):
            break
        time.sleep(0.1)

    if process.poll() is None:
        process.send_signal(signal.SIGINT)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

    pump_thread.join(timeout=2)
    stderr_data = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
    return "".join(chunks), stderr_data, process.returncode


class TestFridaFlags:
    def test_attach_identifier_flag(self, running_app, hook_file):
        stdout, stderr, code = run_frooky(["-U", "-N", running_app.identifier, str(hook_file)])
        assert code == 0, f"frooky failed with stderr: {stderr}\nstdout: {stdout}"
        assert "Hooks ready:" in stdout
        assert running_app.identifier in stdout

    def test_attach_name_flag(self, running_app, hook_file):
        stdout, stderr, code = run_frooky(["-U", "-n", running_app.name, str(hook_file)])
        assert code == 0, f"frooky failed with stderr: {stderr}\nstdout: {stdout}"
        assert "Hooks ready:" in stdout
        assert running_app.name in stdout

    def test_attach_pid_flag(self, running_app, hook_file):
        stdout, stderr, code = run_frooky(["-U", "-p", str(running_app.pid), str(hook_file)])
        assert code == 0, f"frooky failed with stderr: {stderr}\nstdout: {stdout}"
        assert "Hooks ready:" in stdout
        assert str(running_app.pid) in stdout

    def test_attach_frontmost_flag(self, running_app, hook_file):
        stdout, stderr, code = run_frooky(["-U", "-F", str(hook_file)])
        assert code == 0, f"frooky failed with stderr: {stderr}\nstdout: {stdout}"
        assert "Hooks ready:" in stdout

    def test_device_usb_flag(self, running_app, hook_file):
        stdout, stderr, code = run_frooky(["-U", "-N", running_app.identifier, str(hook_file)])
        assert code == 0, f"frooky failed with stderr: {stderr}\nstdout: {stdout}"
        assert "Hooks ready:" in stdout

    def test_device_id_flag(self, running_app, hook_file):
        device_id = frida.get_usb_device().id
        stdout, stderr, code = run_frooky(["-D", device_id, "-N", running_app.identifier, str(hook_file)])
        assert code == 0, f"frooky failed with stderr: {stderr}\nstdout: {stdout}"
        assert device_id in stdout
        assert "Hooks ready:" in stdout

    def test_runtime_qjs_flag(self, running_app, hook_file):
        stdout, stderr, code = run_frooky(["-U", "-N", running_app.identifier, "--runtime", "qjs", str(hook_file)])
        assert code == 0, f"frooky failed with stderr: {stderr}\nstdout: {stdout}"
        assert "Runtime: QuickJS" in stdout
        assert "Hooks ready:" in stdout

    def test_runtime_v8_flag(self, running_app, hook_file):
        stdout, stderr, code = run_frooky(["-U", "-N", running_app.identifier, "--runtime", "v8", str(hook_file)])
        assert code == 0, f"frooky failed with stderr: {stderr}\nstdout: {stdout}"
        assert "Runtime: V8" in stdout
        assert "Hooks ready:" in stdout

    def test_load_script_flag(self, running_app, hook_file, tmp_path):
        script_file = tmp_path / "user_script.js"
        script_file.write_text("console.log('frooky user script loaded');", encoding="utf-8")
        stdout, stderr, code = run_frooky(["-U", "-N", running_app.identifier, "-l", str(script_file), str(hook_file)])
        assert code == 0, f"frooky failed with stderr: {stderr}\nstdout: {stdout}"
        assert "Hooks ready:" in stdout

    def test_spawn_flag(self, hook_file):
        stdout, stderr, code = run_frooky(["-U", "-f", TARGET_APP, str(hook_file)])
        assert code == 0, f"frooky failed with stderr: {stderr}\nstdout: {stdout}"
        assert "(spawned)" in stdout
        assert "Hooks ready:" in stdout

    def test_remote_host_flag_connection_error(self, hook_file):
        stdout, stderr, code = run_frooky(["-H", "127.0.0.1:9999", "-n", "any", str(hook_file)], timeout=3.0)
        assert code != 0
        assert "unable to connect to remote frida-server" in stdout

    def test_certificate_flag_nonexistent(self, hook_file):
        stdout, stderr, code = run_frooky(
            ["-H", "127.0.0.1:9999", "--certificate", "/nonexistent/cert.pem", "-n", "any", str(hook_file)],
            timeout=3.0,
        )
        assert code != 0
        assert "failed to open file" in stdout

    def test_certificate_flag_invalid_pem(self, hook_file, tmp_path):
        cert_file = tmp_path / "invalid.pem"
        cert_file.write_text("NOT_A_VALID_PEM_CERTIFICATE", encoding="utf-8")
        stdout, stderr, code = run_frooky(
            ["-H", "127.0.0.1:9999", "--certificate", str(cert_file), "-n", "any", str(hook_file)],
            timeout=3.0,
        )
        assert code != 0
        assert "no PEM-encoded certificate found" in stdout
