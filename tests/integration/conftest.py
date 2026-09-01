"""Shared fixtures for Android/iOS integration tests."""

import json
import os
import re
import signal
import subprocess
import threading
import time
from pathlib import Path

import pytest
from appium import webdriver
from appium.options.android import UiAutomator2Options
from appium.options.ios import XCUITestOptions
from appium.webdriver.common.appiumby import AppiumBy
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

APPIUM_URL = os.environ.get("APPIUM_URL", "http://127.0.0.1:4723")
FRIDA_HOST = os.environ.get("FRIDA_HOST", "127.0.0.1:27042")

APP_START_TIMEOUT = 60
UI_TIMEOUT = 60
NEW_COMMAND_TIMEOUT = 600

FROOKY_READY_TIMEOUT = 60
FROOKY_EVENT_TIMEOUT = 60
FROOKY_EVENT_SETTLE = 5
FROOKY_STOP_TIMEOUT = 60

MAIN_ACTIVITY = "org.owasp.mastestapp.MainActivity"

# frooky always writes ./output.json relative to its working directory
FROOKY_WORKING_DIR = Path(__file__).parent
FROOKY_OUTPUT_NAME = "output.json"

# if this patterns appears on stdout, frooky hooked all hooks and is read
FROOKY_READY_PATTERN = re.compile(r"Resolved Hooks:\s*(\d+)")


def _matches_subset_pattern_recursive(event, pattern):
    """
    Check if pattern is a subset of event structure.
    - For dicts: pattern keys must exist in event with matching values
    - For lists: pattern and target must have same length, each element must match
    - For primitives: must be equal
    """
    if isinstance(pattern, dict):
        if not isinstance(event, dict):
            return False
        return all(key in event and _matches_subset_pattern_recursive(event[key], value) for key, value in pattern.items())
    if isinstance(pattern, list):
        if not isinstance(event, list) or len(pattern) != len(event):
            return False
        return all(_matches_subset_pattern_recursive(item, expected) for item, expected in zip(event, pattern))
    return event == pattern


@pytest.fixture
def count_matched_events(output_file_path):
    """Factory fixture to scan output NDJSON for hooks matching the patterns."""

    def _count_matched_events(expected_event):
        matched = 0
        with open(output_file_path, "r", encoding="utf8") as handle:
            for line in handle:
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if _matches_subset_pattern_recursive(entry, expected_event):
                    matched += 1
        return matched

    return _count_matched_events


@pytest.fixture(params=["android", "ios"])
def platform(request):
    """Platform to test against."""
    return request.param


def _build_options(platform, app_bundle_id):
    if platform == "android":
        options = UiAutomator2Options()
        options.app_package = app_bundle_id
        options.app_activity = MAIN_ACTIVITY
    else:
        options = XCUITestOptions()
        options.bundle_id = app_bundle_id

    options.no_reset = True
    options.new_command_timeout = NEW_COMMAND_TIMEOUT
    if udid := os.environ.get("DEVICE_UDID"):
        options.udid = udid
    return options


def _wait_for_pid(driver, platform, app_bundle_id):
    """Resolve the PID of the freshly launched app via Appium only."""
    deadline = time.monotonic() + APP_START_TIMEOUT
    while time.monotonic() < deadline:
        if platform == "android":
            output = driver.execute_script("mobile: shell", {"command": "pidof", "args": [app_bundle_id]})
            pid = (output or "").strip().split(" ")[0]
        else:
            info = driver.execute_script("mobile: activeAppInfo") or {}
            pid = str(info["pid"]) if info.get("bundleId") == app_bundle_id else ""

        if pid.isdigit():
            return pid
        time.sleep(0.5)

    pytest.fail(f"Timed out waiting for PID of {app_bundle_id}")


@pytest.fixture
def app_session(platform):
    """Launch the target app and hand out a driver bound to it."""
    drivers = []

    def _launch(app_bundle_id):
        driver = webdriver.Remote(APPIUM_URL, options=_build_options(platform, app_bundle_id))
        drivers.append(driver)
        return driver, _wait_for_pid(driver, platform, app_bundle_id)

    yield _launch

    for driver in drivers:
        driver.quit()


@pytest.fixture
def mastg_app_click_start(platform):
    """Replaces maestro/mastg_demo.yaml: press the start button."""

    def _flow(driver):
        locator = (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().textContains("Start")') if platform == "android" else (AppiumBy.ACCESSIBILITY_ID, "Start")
        WebDriverWait(driver, UI_TIMEOUT).until(EC.element_to_be_clickable(locator)).click()

    return _flow


@pytest.fixture
def output_file_path():
    """Path of the output.json frooky writes into its working directory."""
    return FROOKY_WORKING_DIR / FROOKY_OUTPUT_NAME


@pytest.fixture(autouse=True)
def cleanup_output_json(output_file_path):
    """Remove output.json before each test, but keep it afterwards for inspection."""
    output_file_path.unlink(missing_ok=True)
    yield


def _drain_output(process):
    """
    Consume frooky's output in a background thread and return an accumulator.

    Required because the status screen is redrawn continuously: an unread pipe
    would fill up and block frooky. read1() is used since the TUI updates with
    carriage returns instead of newlines.
    """
    chunks = []

    def _pump():
        for chunk in iter(lambda: process.stdout.read1(4096), b""):
            chunks.append(chunk.decode("utf8", errors="replace"))

    threading.Thread(target=_pump, daemon=True).start()
    return chunks


def _hooks_resolved(chunks):
    matches = FROOKY_READY_PATTERN.findall("".join(chunks))
    return bool(matches) and int(matches[-1]) > 0


def _count_events(output_file_path):
    if not output_file_path.is_file():
        return 0
    count = 0
    for line in output_file_path.read_text(encoding="utf8", errors="replace").splitlines():
        try:
            json.loads(line)
        except json.JSONDecodeError:
            continue
        count += 1
    return count


def _fail(message, process, chunks):
    pytest.fail(f"{message}\n--- frooky output ---\n{''.join(chunks)}")


def _wait_for_frooky(process, chunks):
    deadline = time.monotonic() + FROOKY_READY_TIMEOUT
    while time.monotonic() < deadline:
        if _hooks_resolved(chunks):
            return
        if process.poll() is not None:
            _fail(f"frooky exited with {process.returncode} before resolving hooks", process, chunks)
        time.sleep(0.5)
    _fail("frooky never reported 'Resolved Hooks: <n>' with n > 0", process, chunks)


def _wait_for_events(process, chunks, output_file_path):
    """Wait for the first event, then until the count stops growing."""
    deadline = time.monotonic() + FROOKY_EVENT_TIMEOUT
    while _count_events(output_file_path) == 0:
        if process.poll() is not None:
            _fail(f"frooky exited with {process.returncode} before writing events", process, chunks)
        if time.monotonic() > deadline:
            _fail(f"no events written to {output_file_path} after pressing Start", process, chunks)
        time.sleep(0.5)

    previous = -1
    while True:
        current = _count_events(output_file_path)
        if current == previous:
            return
        previous = current
        time.sleep(FROOKY_EVENT_SETTLE)


def _stop_frooky(process):
    """SIGINT first, so frooky can detach the agent and flush its NDJSON output."""
    if process.poll() is None:
        process.send_signal(signal.SIGINT)
        try:
            process.wait(timeout=FROOKY_STOP_TIMEOUT)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


@pytest.fixture
def run_frooky(platform, output_file_path, app_session, mastg_app_click_start, tmp_path):
    def _run_frooky(hook_file, target_app):
        app_bundle_id = f"{target_app.replace('-', '_')}.frooky.target.app"

        # 1. Appium launches the app, resolve its PID
        driver, target_app_pid = app_session(app_bundle_id)

        # JSON is a subset of YAML, so a dict can be dumped as-is
        hook_path = tmp_path / "hooks.yaml"
        hook_path.write_text(json.dumps(hook_file), encoding="utf8")

        process = subprocess.Popen(
            [
                "frooky",
                platform,
                *(["-U"] if platform == "android" else []),
                "-p",
                str(target_app_pid),
                "-o",
                str(output_file_path),
                str(hook_path),
            ],
            cwd=FROOKY_WORKING_DIR,  # frooky writes ./output.json relative to cwd
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        chunks = _drain_output(process)

        try:
            # 2. frooky is ready once it reports resolved hooks
            _wait_for_frooky(process, chunks)

            # 3. only now trigger the UI
            mastg_app_click_start(driver)

            # 4. the events are produced by the click, so wait for them here
            _wait_for_events(process, chunks, output_file_path)
        finally:
            _stop_frooky(process)

        return output_file_path

    return _run_frooky
