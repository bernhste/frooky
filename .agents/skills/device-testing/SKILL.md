---
name: device-testing
description: Use when running or debugging frooky tests that need an Android emulator or device, meaning the agent tests (`npm run test:android`) and the host integration tests (`pytest tests/integration/android`), or when checking a change end to end with the real `frooky` CLI against an app.
---

# Testing against a device

## 1. Check the environment

In the devcontainer, adb, Appium and frida-server run on the **host machine**, started by `.devcontainer/host-services-start.sh`. The container reaches them via environment variables:

- `ADB_SERVER_SOCKET=tcp:host.docker.internal:5037`
- `APPIUM_URL=http://host.docker.internal:4723`
- `FRIDA_HOST=host.docker.internal:27042`

```bash
timeout 10 adb devices                                  # expect e.g. "emulator-5554  device"
uv run scripts/list_android_devices.py                  # which serial is which Android version
adb shell 'ps -A | grep -i frida'                       # frida-server must run (name may carry a version suffix)
frida-ps -U | head -3                                   # host frida can talk to it
frida --version; adb shell 'for f in /data/local/tmp/frida-server*; do $f --version; done'   # mismatch is the usual cause of connect errors
```

If no device is listed, stop and tell the user. The emulator and host services have to be started on the host, and you can't do that from inside the container.

If frida-server isn't running, or `frida` reports `Need Gadget to attach on jailed Android`, prepare the devices (they must be rooted, as on emulator `google_apis` images):

```bash
uv run scripts/prepare_android_devices.py        # all attached devices; -s <serial> for one
```

For each device it gets root (`adb root`, else `su`), sets SELinux to permissive, installs the newest frida-server with the host frida's major version to `/data/local/tmp/frida-server-<version>` (`--frida-version` to pick one), stops servers of other versions, starts it and checks that frida reaches it. It's safe to rerun. frida-server doesn't survive an emulator restart.

## 2. Agent tests (TypeScript)

```bash
cd frooky/agent
npm run test:android
```

This spawns `com.google.android.dialer` and runs every `*.test.ts` under `src/` inside it with `frida-test`. On an image without the Google dialer, it uses the AOSP one (`com.android.dialer`); `FRIDA_TEST_APP=<package>` picks another app.

The device is chosen like adb does: `npm run test:android -- -s <serial>`, else `$ANDROID_SERIAL`, else the only attached one; with several attached and neither set, it stops and lists them. `npm run test:android -- -a` runs once per attached device, prints a summary and fails if any device fails; `-o out.json` then writes `out-<serial>.json` per device. To run a subset while iterating, call frida-test directly with explicit paths:

```bash
npx frida-test -U -f 'com.google.android.dialer' ./src/android/decoders/android/os   # -D <serial> instead of -U with several devices
```

## 3. Host integration tests (Python)

These need the **target apps** installed and **Appium** reachable. Each test launches an app via Appium, attaches `frooky -U -p <pid>` with an inline hook file, taps "Start", and asserts on `output.json`.

```bash
uv run scripts/sync_target_apps.py      # builds the apps, installs the latest build where it's missing or outdated; -c for a clean build
uv run compile-agent --dev && uv sync   # the host must bundle the current agent
uv run scripts/run_integration_tests.py -k <pattern>   # -s <serial> | -a for all, --appium <ip>[:<port>]; other args go to pytest
```

- The script chooses the device like adb (`-s <serial>`, else `$ANDROID_SERIAL`, else the only attached one; `-a` runs on each and prints a summary) and passes it to the tests as `ANDROID_SERIAL`, so frooky, frida, adb and Appium all use that device. Plain `pytest tests/integration/android` works too, with `ANDROID_SERIAL` set when several devices are attached.
- Appium is `$APPIUM_URL`, else `127.0.0.1:4723`; `--appium <ip>[:<port>]` overrides it. The script stops right away if Appium isn't reachable.
- `uv run scripts/sync_target_apps.py <app> -s <serial>` narrows the sync to one app or device. Use `-c` after changing `build.gradle.kts.*` or `AndroidManifest.xml` or removing a source file.
- Package ids are `<target-app with - replaced by _>.frooky.target.app`, e.g. `value_passing_java.frooky.target.app`.
- Test methods in the target app live in `tests/target-apps/android/<app>/MastgTest.kt` (or the C sources for `value-passing-native`). Assertions compare against the literal values in those files, so change both together.
- Fixtures (`run_frooky`, `find_matched_events`, `count_matched_events`) are in `tests/integration/conftest.py`. Each line in `output.json` is a JSON array of events; the fixtures flatten it.

## 4. Full check on every device

```bash
uv run scripts/platform_check.py
```

Builds the agent, runs the host unit tests, then the agent and integration tests on every attached device (`-s <serial>` for one, repeatable), and writes `.platform-check/<timestamp>/report.md`. `--skip unit,agent,integration` skips steps, `-k <pattern>` narrows the integration tests. Use it only when the user asks for all tests (see `docs/develop.md`).

## 5. Manual end-to-end check

```bash
uv run compile-agent --dev
uv run frooky -U -f <package> -e -vv hooks.yaml   # -e prints events, -vv adds agent debug logs
```

## Troubleshooting

- `(N waiting)` in the status bar (`Hooks ready: …` when output is piped): the class or module isn't loaded yet, or its name is wrong. Waiting hooks are installed when it loads, e.g. after pressing "Start". Check the name with `frida -U <app>` → `Java.use("...")`. `(N not found)` means the class or module was found but the method or symbol wasn't.
- `unable to connect to remote frida-server`, a version-mismatch error, or the app crashing with `Agent connection closed unexpectedly` right after spawn: run `uv run scripts/prepare_android_devices.py` to install a current frida-server.
- Appium session errors in integration tests: the host relay can drop connections, and the tests retry a few times. Check that Appium is running on the host (`curl $APPIUM_URL/status`).
