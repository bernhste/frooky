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
adb shell 'ps -A | grep -i frida'                       # frida-server must run (name may carry a version suffix)
frida-ps -U | head -3                                   # host frida can talk to it
frida --version; adb shell 'for f in /data/local/tmp/frida-server*; do $f --version; done'   # mismatch is the usual cause of connect errors
```

If no device is listed, stop and tell the user. The emulator and host services have to be started on the host, and you can't do that from inside the container.

If frida-server isn't running (the device must be rooted, as on emulator `google_apis` images):

```bash
.github/scripts/android/prep-device.sh           # adb root, setenforce 0
.github/scripts/android/install-frida-server.sh  # downloads the x86_64 server matching `frida --version`
```

`install-frida-server.sh` assumes an x86_64 emulator. For arm64 devices, download the matching `android-arm64` build instead.

## 2. Agent tests (TypeScript)

```bash
cd frooky/agent
npm run test:android
```

This spawns `com.google.android.dialer` and runs every `*.test.ts` under `src/` inside it with `frida-test`. To run a subset while iterating, call frida-test directly with explicit paths:

```bash
npx frida-test -U -f 'com.google.android.dialer' ./src/android/decoders/android/os
```

## 3. Host integration tests (Python)

These need the **target apps** installed and **Appium** reachable. Each test launches an app via Appium, attaches `frooky -U -p <pid>` with an inline hook file, taps "Start", and asserts on `output.json`.

```bash
cd tests/target-apps/android
make build TARGET_APP=value-passing-java    # or: make build-all
make install TARGET_APP=value-passing-java  # or: make install-all
cd -
./compileAgent.sh --dev && pip install -e '.[dev]'   # the host must bundle the current agent
pytest tests/integration/android -k <pattern>
```

- Package ids are `<target-app with - replaced by _>.frooky.target.app`, e.g. `value_passing_java.frooky.target.app`.
- Test methods in the target app live in `tests/target-apps/android/<app>/MastgTest.kt` (or the C sources for `value-passing-native`). Assertions compare against the literal values in those files, so change both together.
- Fixtures (`run_frooky`, `find_matched_events`, `count_matched_events`) are in `tests/integration/conftest.py`. Each line in `output.json` is a JSON array of events; the fixtures flatten it.

## 4. Manual end-to-end check

```bash
./compileAgent.sh --dev
frooky -U -f <package> -e -vv hooks.yaml   # -e prints events, -vv shows agent debug logs
```

## Troubleshooting

- `Resolved Hooks: 0`: the class or module isn't loaded yet or the name is wrong. Try `-t 15`, and check the name with `frida -U <app>` → `Java.use("...")`.
- `unable to connect to remote frida-server` or a version-mismatch error: restart frida-server on the device with the matching version.
- Appium session errors in integration tests: the host relay can drop connections, and the tests retry a few times. Check that Appium is running on the host (`curl $APPIUM_URL/status`).
