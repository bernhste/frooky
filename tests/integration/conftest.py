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
import urllib3
from appium import webdriver
from appium.options.android import UiAutomator2Options
from appium.options.ios import XCUITestOptions
from appium.webdriver.common.appiumby import AppiumBy
from selenium.common.exceptions import StaleElementReferenceException, WebDriverException
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

APPIUM_URL = os.environ.get("APPIUM_URL", "http://127.0.0.1:4723")

# on Linux devcontainers, APPIUM_URL is typically reached through a socat relay on the host
# (see .devcontainer/host-services-start.sh) rather than a direct loopback connection, so a
# session request can occasionally hit a transient connection drop under repeated test churn.
NEW_SESSION_RETRIES = 3
NEW_SESSION_RETRY_DELAY = 2
FRIDA_HOST = os.environ.get("FRIDA_HOST", "127.0.0.1:27042")

APP_START_TIMEOUT = 60
UI_TIMEOUT = 60
NEW_COMMAND_TIMEOUT = 600

FROOKY_READY_TIMEOUT = 60
FROOKY_EVENT_TIMEOUT = 60
# the agent sends queued events every 100 ms (SEND_INTERVAL_MS), so 1 s covers the last batch
FROOKY_EVENT_SETTLE = 1
FROOKY_STOP_TIMEOUT = 60
# how long to let the app's test flow run on platforms without a result locator
MASTG_RESULT_FALLBACK_WAIT = 10

MAIN_ACTIVITY = "org.owasp.mastestapp.MainActivity"
# the result text view shows only this until mastgTest() has returned
MASTG_DEFAULT_MESSAGE = 'Click "Start" to run the test.'

# frooky always writes ./output.json relative to its working directory
FROOKY_WORKING_DIR = Path(__file__).parent
FROOKY_OUTPUT_NAME = "output.json"

# if this pattern appears on stdout, frooky resolved all hooks and is ready; waiting hooks are installed when
# their class or module loads, e.g. after pressing "Start"
FROOKY_READY_PATTERN = re.compile(r"Hooks ready:\s*(\d+) hooked(?:, (\d+) waiting)?")


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


def _iter_events(output_file_path):
    """Yields every individual event written to output.json.

    Each line frooky writes is a batch: a JSON array of events sent together by the agent's
    event sender (see eventSender.ts), not a single event object, so lines are flattened here.
    """
    with open(output_file_path, "r", encoding="utf8") as handle:
        for line in handle:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            yield from (entry if isinstance(entry, list) else [entry])


@pytest.fixture
def count_matched_events(output_file_path):
    """Factory fixture to count events in output.json matching the given pattern."""

    def _count_matched_events(expected_event):
        return sum(1 for event in _iter_events(output_file_path) if _matches_subset_pattern_recursive(event, expected_event))

    return _count_matched_events


@pytest.fixture
def find_matched_events(output_file_path):
    """Factory fixture returning the actual events in output.json matching the given pattern.

    Use this over count_matched_events when a test needs to inspect decoded values rather than
    just confirm a hook fired.
    """

    def _find_matched_events(expected_event):
        return [event for event in _iter_events(output_file_path) if _matches_subset_pattern_recursive(event, expected_event)]

    return _find_matched_events


@pytest.fixture(params=["android", "ios"])
def platform(request):
    """Platform to test against."""
    return request.param


def _build_options(platform, app_bundle_id):
    if platform == "android":
        options = UiAutomator2Options()
        options.app_package = app_bundle_id
        options.app_activity = MAIN_ACTIVITY
        options.set_capability("appium:forceAppLaunch", True)
    else:
        options = XCUITestOptions()
        options.bundle_id = app_bundle_id

    options.no_reset = True
    options.new_command_timeout = NEW_COMMAND_TIMEOUT
    if udid := os.environ.get("DEVICE_UDID"):
        options.udid = udid
    return options


def _start_button(platform):
    return (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().textContains("Start")') if platform == "android" else (AppiumBy.ACCESSIBILITY_ID, "Start")


def _wait_for_pid(driver, platform, app_bundle_id):
    """Resolve the PID of the freshly launched app via Appium only."""
    deadline = time.monotonic() + APP_START_TIMEOUT
    while time.monotonic() < deadline:
        if platform == "android":
            try:
                output = driver.execute_script("mobile: shell", {"command": "pidof", "args": [app_bundle_id]})
            except WebDriverException:
                # pidof exits with 1 while the process doesn't exist yet
                output = ""
            pid = (output or "").strip().split(" ")[0]
        else:
            info = driver.execute_script("mobile: activeAppInfo") or {}
            pid = str(info["pid"]) if info.get("bundleId") == app_bundle_id else ""

        if pid.isdigit():
            return pid
        time.sleep(0.5)

    pytest.fail(f"Timed out waiting for PID of {app_bundle_id}")


def _new_session(options):
    """Creates an Appium session, retrying on a transient connection failure to APPIUM_URL."""
    for attempt in range(1, NEW_SESSION_RETRIES + 1):
        try:
            return webdriver.Remote(APPIUM_URL, options=options)
        except urllib3.exceptions.MaxRetryError:
            if attempt == NEW_SESSION_RETRIES:
                raise
            time.sleep(NEW_SESSION_RETRY_DELAY)


@pytest.fixture(scope="session")
def appium_drivers():
    """One Appium session per platform, shared by all tests: starting UiAutomator2 per test is slow."""
    drivers = {}
    yield drivers
    for driver in drivers.values():
        driver.quit()


@pytest.fixture
def app_session(platform, appium_drivers):
    """Launch a fresh process of the target app and hand out a driver bound to it."""

    def _launch(app_bundle_id):
        driver = appium_drivers.get(platform)
        if driver is not None:
            # a fresh process per test: an app left stuck by a failed run (e.g. frooky killed while
            # detaching) otherwise times out every following attach
            try:
                driver.terminate_app(app_bundle_id)
                driver.activate_app(app_bundle_id)
            except WebDriverException:
                appium_drivers.pop(platform)
                driver = None
        if driver is None:
            driver = _new_session(_build_options(platform, app_bundle_id))
            appium_drivers[platform] = driver
        pid = _wait_for_pid(driver, platform, app_bundle_id)
        # attaching while the app still starts up can time out syncing with the agent
        WebDriverWait(driver, APP_START_TIMEOUT).until(EC.presence_of_element_located(_start_button(platform)))
        return driver, pid

    return _launch


@pytest.fixture
def mastg_app_click_start(platform):
    """Replaces maestro/mastg_demo.yaml: press the start button."""

    def _flow(driver):
        WebDriverWait(driver, UI_TIMEOUT).until(EC.element_to_be_clickable(_start_button(platform))).click()

    return _flow


@pytest.fixture
def mastg_app_wait_for_result(platform):
    """Wait until the app shows the result of mastgTest(), i.e. every hooked call has happened."""

    def _wait(driver):
        if platform != "android":
            time.sleep(MASTG_RESULT_FALLBACK_WAIT)
            return
        locator = (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().textStartsWith("Click ")')
        WebDriverWait(driver, UI_TIMEOUT, ignored_exceptions=[StaleElementReferenceException]).until(lambda d: d.find_element(*locator).text.strip() != MASTG_DEFAULT_MESSAGE)

    return _wait


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
    if not matches:
        return False
    hooked, waiting = matches[-1]
    return int(hooked) > 0 or int(waiting or 0) > 0


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
    _fail("frooky never reported 'Hooks ready: <n> hooked' with hooked or waiting hooks", process, chunks)


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


def _wait_after_click_with_no_events_expected(process, chunks):
    """For tests where the click should legitimately produce zero events (e.g. an event-level
    callerFilter that matches nothing): give the last batch time to arrive, without treating
    an empty output.json as a failure."""
    time.sleep(FROOKY_EVENT_SETTLE)
    if process.poll() is not None:
        _fail(f"frooky exited with {process.returncode} unexpectedly", process, chunks)


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
def run_frooky(platform, output_file_path, app_session, mastg_app_click_start, mastg_app_wait_for_result, tmp_path):
    def _run_frooky(hook_file_yaml, target_app, expect_events=True):
        """Launch target_app, attach frooky with hook_file_yaml, then click Start.

        Set expect_events=False for a hook file that's expected to legitimately produce zero
        events (e.g. an callerFilter matching nothing) - otherwise the normal
        "wait for the first event" step would time out waiting for something that never comes.
        """
        app_bundle_id = f"{target_app.replace('-', '_')}.frooky.target.app"

        # 1. Appium launches the app, resolve its PID
        driver, target_app_pid = app_session(app_bundle_id)

        # written as real YAML text (not json.dumps'd) so frooky's own yaml.safe_load path is
        # exercised end to end, not just its JSON-is-a-subset-of-YAML fallback.
        hook_path = tmp_path / "hooks.yaml"
        hook_path.write_text(hook_file_yaml, encoding="utf8")

        process = subprocess.Popen(
            [
                "frooky",
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
            # stdout isn't a TTY here, so Python fully block-buffers frooky's own output by
            # default - it would otherwise sit unflushed until the process exits, well past
            # FROOKY_READY_TIMEOUT, even though frooky reports readiness almost immediately.
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        chunks = _drain_output(process)

        try:
            # 2. frooky is ready once it reports resolved hooks
            _wait_for_frooky(process, chunks)

            # 3. only now trigger the UI
            mastg_app_click_start(driver)
            mastg_app_wait_for_result(driver)

            # 4. the events are produced by the click, so wait for them here
            if expect_events:
                _wait_for_events(process, chunks, output_file_path)
            else:
                _wait_after_click_with_no_events_expected(process, chunks)
        finally:
            _stop_frooky(process)

        return output_file_path

    return _run_frooky


@pytest.fixture
def run_frooky_spawn(platform, output_file_path, app_session, tmp_path):
    def _run_frooky_spawn(hook_file_yaml, target_app, user_scripts=()):
        """Let frooky spawn target_app (-f) with hook_file_yaml, and collect the events of the app's startup.

        No UI is triggered: this is for hooks on code that runs while the app starts. `user_scripts` are
        paths of Frida scripts loaded with -l before the agent."""
        app_bundle_id = f"{target_app.replace('-', '_')}.frooky.target.app"

        # stop the app, so frooky starts a fresh process
        driver, _ = app_session(app_bundle_id)
        driver.terminate_app(app_bundle_id)

        hook_path = tmp_path / "hooks.yaml"
        hook_path.write_text(hook_file_yaml, encoding="utf8")

        process = subprocess.Popen(
            [
                "frooky",
                *(["-U"] if platform == "android" else []),
                "-f",
                app_bundle_id,
                *[arg for script in user_scripts for arg in ("-l", str(script))],
                "-o",
                str(output_file_path),
                str(hook_path),
            ],
            cwd=FROOKY_WORKING_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        chunks = _drain_output(process)

        try:
            _wait_for_frooky(process, chunks)
            _wait_for_events(process, chunks, output_file_path)
        finally:
            _stop_frooky(process)

        return output_file_path

    return _run_frooky_spawn


# frooky logs e.g. `Updated hooks.yaml: 1 removed, 2 unchanged` once a changed hook file is applied (-w)
FROOKY_UPDATED_PATTERN = re.compile(r"Updated hooks\.yaml:")


class WatchedFrooky:
    """A frooky process started with `-w`, whose hook file can be changed while it runs."""

    def __init__(self, process, chunks, driver, hook_path, output_file_path, click_start):
        self._process = process
        self._chunks = chunks
        self._driver = driver
        self._hook_path = hook_path
        self._output_file_path = output_file_path
        self._click_start = click_start

    def _events(self):
        return list(_iter_events(self._output_file_path)) if self._output_file_path.is_file() else []

    def click_start_and_collect(self, expected_event):
        """Press Start and return the events of this round only that match expected_event."""
        offset = len(self._events())
        self._click_start(self._driver)
        deadline = time.monotonic() + FROOKY_EVENT_TIMEOUT
        while len(self._events()) == offset:
            if self._process.poll() is not None:
                _fail(f"frooky exited with {self._process.returncode} before writing events", self._process, self._chunks)
            if time.monotonic() > deadline:
                _fail("no new events written after pressing Start", self._process, self._chunks)
            time.sleep(0.5)
        previous = -1
        while (current := len(self._events())) != previous:
            previous = current
            time.sleep(FROOKY_EVENT_SETTLE)
        return [event for event in self._events()[offset:] if _matches_subset_pattern_recursive(event, expected_event)]

    def update_hook_file(self, hook_file_yaml):
        """Rewrite the hook file and wait until frooky applied it."""
        applied = len(FROOKY_UPDATED_PATTERN.findall("".join(self._chunks)))
        self._hook_path.write_text(hook_file_yaml, encoding="utf8")
        deadline = time.monotonic() + FROOKY_READY_TIMEOUT
        while len(FROOKY_UPDATED_PATTERN.findall("".join(self._chunks))) == applied:
            if self._process.poll() is not None:
                _fail(f"frooky exited with {self._process.returncode} while reloading", self._process, self._chunks)
            if time.monotonic() > deadline:
                _fail("frooky never applied the changed hook file", self._process, self._chunks)
            time.sleep(0.5)


@pytest.fixture
def run_frooky_watch(platform, output_file_path, app_session, mastg_app_click_start, tmp_path):
    """Like run_frooky, but starts frooky with `-w` and hands out a WatchedFrooky for the test to drive.
    frooky is stopped after the test."""
    processes = []

    def _run_frooky_watch(hook_file_yaml, target_app):
        app_bundle_id = f"{target_app.replace('-', '_')}.frooky.target.app"
        driver, target_app_pid = app_session(app_bundle_id)
        hook_path = tmp_path / "hooks.yaml"
        hook_path.write_text(hook_file_yaml, encoding="utf8")

        process = subprocess.Popen(
            [
                "frooky",
                *(["-U"] if platform == "android" else []),
                "-w",
                "-v",  # the agent's `Updated hooks.yaml: ...` summary is an info log
                "-p",
                str(target_app_pid),
                "-o",
                str(output_file_path),
                str(hook_path),
            ],
            cwd=FROOKY_WORKING_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        processes.append(process)
        chunks = _drain_output(process)
        _wait_for_frooky(process, chunks)
        return WatchedFrooky(process, chunks, driver, hook_path, output_file_path, mastg_app_click_start)

    yield _run_frooky_watch

    for process in processes:
        _stop_frooky(process)
