# Development / Local Testing

This document describes how to set up a local development environment for the repository on macOS.

## Prerequisites

- Python 3+ (use `python3`)
- Node.js (LTS) and `npm` or `pnpm` for JS tooling (optional)
- A physical device or emulator with `frida-server` for rooted testing (common for Android)
- Frida Gadget only for jailed/non-root scenarios

## Running the CLI locally

1. **Sync dependencies and install frooky in editable mode**:

   ```bash
   uv sync
   ```

   This creates a virtual environment at `.venv` with all dependencies installed.

2. **Compile the frooky agent**:

   ```bash
   uv run compile-agent --dev
   ```

3. **Run the CLI**:

   Run `frooky` directly using `uv run`:

   ```bash
   uv run frooky --help
   ```

   Or activate the virtual environment:

   ```bash
   source .venv/bin/activate
   which frooky
   ```

   The output should be a path within `.venv`, typically ending with `.venv/bin/frooky`.

## Debugging and Profiling the Agent

By default, Frida runs the frooky agent in the QuickJS runtime. `--runtime v8` runs it in V8 instead, which also applies to scripts loaded with `-l`.

`--debug` switches to V8 and opens a Chrome Inspector server for the frooky agent on port 9229. The server runs on the machine running `frooky`, not on the device, so no port forwarding is needed:

```bash
frooky -U -f org.owasp.mastestapp --debug hooks.yaml
```

Open `chrome://inspect` in Chrome. The agent is listed under **Remote Target** as `localhost:9229`, with an entry named after the frooky process, e.g. `python3.13[12345]`. If it isn't listed, add `localhost:9229` under **Configure...**. When frooky runs in the devcontainer, VS Code forwards the port to your machine; check its **Ports** view if the target doesn't show up.

Click **inspect** on the entry. If the DevTools window stays blank, use **inspect fallback**. Alternatively, **Open dedicated DevTools for Node** connects to `localhost:9229` on its own and reconnects after you restart frooky. The DevTools window lets you:

- record CPU profiles in the **Performance** tab and view them as a flame chart,
- take heap snapshots in the **Memory** tab,
- evaluate expressions in the **Console** tab.

Reading and stepping through the agent code in the **Sources** tab doesn't work yet, see [Current Limitations](#current-limitations).

Keep in mind:

- The agent is loaded and resolves the hook files before you can connect, so startup is not in a profile. To profile hook resolving, run with `-w`, start recording, and save a changed hook file.
- A paused breakpoint blocks every app thread that calls a hooked method, which can make the app stop responding.
- V8 compiles hot code to machine code and QuickJS doesn't, so V8 profiles show where the time goes, not how long it takes in the default runtime.
- Only one debugger can listen on port 9229. Stop other `frooky --debug` or Node.js debugging sessions first.

### Current Limitations

These come from Frida (as of Frida 17.18 and frida-compile 19.0.5), not from frooky:

- **Messages larger than 512 KiB are cut off.** Frida's inspector server truncates every DevTools message at 524,287 bytes, and DevTools then waits forever for the rest. The agent bundle is about 1.3 MB (704 KiB of it is zod, 376 KiB frida-java-bridge), so the **Sources** tab lists `/src/build/index.frooky.js` but never finishes loading it. You can't read the code or set breakpoints there. The flame chart still shows the function names; search for them in `frooky/agent/src/`.
- **Long CPU recordings break the same way.** A profile of a busy agent grows by roughly 8 KiB per second, so keep recordings under about 30 seconds. Idle time adds almost nothing.
- **No source maps.** frida-compile declares `-S, --no-source-maps` with a default of `false`, so it never includes source maps, with or without `-S`. Even with a source map in the bundle, Frida doesn't pass it on to DevTools, so the TypeScript files wouldn't show up anyway.

A possible workaround on frooky's side is to write frooky's own code (about 115 KiB) and the libraries as separate modules into the one bundle file. Frida's bundle format supports that, and each module then shows up as its own script in DevTools, but frida-compile can't produce it, so `build.js` would need its own bundling step.

## Testing

The project consists of two testable components: a Frida agent written in TypeScript and a Python host.

The agent has its own dedicated unit tests that run directly on a target device, as the agent's functionality is tied to the runtime environment Frida operates in.

The host, on the other hand, serves as an integration test for the full application.

The following chapters describe how to write tests and target apps the tests should run against.

### Building Target App

Tests usually require a target app which implements the feature that should be tested.

You find them in the folder `tests/target-apps`, together with [instructions](../tests/target-apps/README.md) how to build them.

### Installing the Target App

On Android, [`sync_target_apps.py`](#sync_target_appspy) builds the apps and installs the latest build on every attached device. Otherwise, build the app and install it with the Makefile:

```bash
cd tests/target-apps/<android|ios>
make install
```

> [!NOTE]
> Before proceeding, make sure Frida is available on the target device (Android) or on the local machine (iOS Simulator).

### Running Agent Tests

The agent's unit tests are the `*.test.ts` files next to the code in `frooky/agent/src/`. They use [frida-test](https://www.npmjs.com/package/frida-test) (`describe`, `it`, `expect`) and run inside a live app process on a device, so `Java.use`, `Process` and `Module` work in them. They can't run without a device.

Install the Node.js dependencies once, and again after `package-lock.json` changes:

```bash
cd frooky/agent
npm ci
```

Then run the tests from `frooky/agent`:

```bash
npm run test:android                       # the only attached device, or $ANDROID_SERIAL
npm run test:android -- -s emulator-5554   # one of several devices (serials: scripts/list_android_devices.py)
npm run test:android -- -a                 # every attached device, one after another
```

- The device needs a running frida-server, which [`prepare_android_devices.py`](#prepare_android_devicespy) sets up.
- The tests run in `com.google.android.dialer`, or in `com.android.dialer` on images without the Google dialer, e.g. Android 12. `FRIDA_TEST_APP=<package>` picks another app. frida-test spawns the app, so it doesn't have to be running.
- With several devices attached and neither `-s` nor `ANDROID_SERIAL`, the script stops and lists the devices.
- With `-a`, it prints a summary per device and fails if any device failed.
- Other arguments go to frida-test, e.g. `npm run test:android -- -a -o out.json` writes `out-<serial>.json` per device. `npm run test:android -- -s emulator-5554 -t 300` lowers the timeout from 600 to 300 seconds.

The script is `frooky/agent/scripts/test-android.sh`. It runs every test file under `src/`. To run only some files while iterating, call frida-test directly with paths:

```bash
npx frida-test -D emulator-5554 -f com.google.android.dialer ./src/shared/utils.test.ts ./src/android/decoders
```

frida-test bundles the test files and the agent code they import on its own, so the agent tests don't need `npm run build:dev:android` first. The host and the integration tests do, because they load `dist/agent-android.js`.

iOS isn't complete yet and has no agent test script.

### Writing Agent Tests

Put the test next to the code it tests, e.g. `src/shared/utils.test.ts` for `src/shared/utils.ts`. `npm run test:android` picks it up without registering it anywhere. `describe`, `it` and `expect` are globals, typed through `frida-test` in `tsconfig.json`:

```ts
import { wildcardPatternToRegExp } from "./utils";

describe("wildcardPatternToRegExp()", () => {
  it("matches '*' against exactly one dot-separated segment", () => {
    expect(wildcardPatternToRegExp("org.owasp.*.HttpClient").test("org.owasp.network.HttpClient")).toBeTruthy();
  });
});
```

The test app is a system app, not one of the target apps. A test that needs a specific Java method or native function belongs in an integration test against a [target app](#building-target-app).

## Development Scripts

The scripts in `scripts/` set up Android devices and run the tests on one or several of them. Run them with `uv run` from the repository root. Each one prints its options with `--help`.

They reach the devices through adb and honor `ADB_SERVER_SOCKET`, so they also work from the devcontainer, where adb runs on the host. Most of them choose devices like adb does:

- `-s <serial>` picks a device. For `prepare_android_devices.py`, `sync_target_apps.py` and `platform_check.py` you can repeat it.
- Without `-s`, the setup scripts and `platform_check.py` work on every attached device. `run_integration_tests.py` uses `$ANDROID_SERIAL`, else the only attached device, and needs `-a` to run on all of them.

A typical session with several emulators:

```bash
uv run scripts/list_android_devices.py       # which serial is which Android version
uv run scripts/prepare_android_devices.py    # root and frida-server on every device
uv run scripts/sync_target_apps.py           # build and install the target apps everywhere
uv run scripts/run_integration_tests.py -s emulator-5556 -k receive_int
```

### list_android_devices.py

Prints the serial, state, Android version, API level, ABI and model of every device that `adb devices` lists, sorted by API level. Use it to find the serial for `-s`:

```console
$ uv run scripts/list_android_devices.py
SERIAL         STATE   ANDROID  API  ABI        MODEL
emulator-5562  device  12       31   arm64-v8a  sdk_gphone64_arm64
emulator-5554  device  15       35   arm64-v8a  sdk_gphone16k_arm64
emulator-5558  device  17       37   arm64-v8a  sdk_gphone16k_arm64
```

Offline or unauthorized devices are listed with their state but without properties.

### prepare_android_devices.py

Sets up each device for frooky:

1. Gets root, with `adb root` or else `su`.
2. Sets SELinux to permissive.
3. Installs the newest frida-server with the host frida's major version to `/data/local/tmp/frida-server-<version>`.
4. Stops frida-servers of other versions and starts that one.
5. Checks that frida can reach it.

Within a major version, client and server are compatible, and newer servers carry fixes for newer Android versions. Downloads are cached in `~/.cache/frooky/frida-server/`. The script is safe to rerun. Run it again after restarting an emulator, because frida-server doesn't survive a restart.

```bash
uv run scripts/prepare_android_devices.py                            # every attached device
uv run scripts/prepare_android_devices.py -s emulator-5554           # one device
uv run scripts/prepare_android_devices.py --frida-version 17.19.0    # a specific frida-server
```

```console
===== emulator-5554 =====
  ok    connected, Android 15, arm64-v8a
  ok    adbd runs as root
  ok    SELinux Permissive
  ok    /data/local/tmp/frida-server-17.22.0 installed
  ok    frida-server 17.22.0 running
  ok    frida connects (access: full)
===== Summary =====
ready   emulator-5554
```

Run it when frida reports `unable to connect to remote frida-server` or `Need Gadget to attach on jailed Android`, or when the app crashes right after spawn with `Agent connection closed unexpectedly`.

### sync_target_apps.py

Builds the Android [target apps](../tests/target-apps/README.md) with the Makefile in `tests/target-apps/android`. Then, on each device, it compares the SHA-256 of the installed APK with `dist/<app>.apk`. An app that is missing or differs is uninstalled, so nothing of the old build remains, and installed again. Apps that are up to date are left alone.

```bash
uv run scripts/sync_target_apps.py                                # all apps, all devices
uv run scripts/sync_target_apps.py value-passing-native           # one app
uv run scripts/sync_target_apps.py -s emulator-5554 -s emulator-5556
uv run scripts/sync_target_apps.py -c                             # clean build
```

Builds are incremental: they copy the sources over the previous build. Use `-c` after changing an app's `build.gradle.kts.*` or `AndroidManifest.xml` or removing a source file.

### run_integration_tests.py

Runs the Android integration tests in `tests/integration/android` with pytest. It passes the device to the tests as `ANDROID_SERIAL`, so frooky, frida, adb and Appium all use the same device. Arguments it doesn't know go to pytest. Without a test path, it runs the whole folder.

```bash
uv run scripts/run_integration_tests.py -k receive_int                    # the only attached device or $ANDROID_SERIAL
uv run scripts/run_integration_tests.py -s emulator-5554 -k receive_int   # one of several devices
uv run scripts/run_integration_tests.py -a -x                             # every device, stop each run at the first failure
uv run scripts/run_integration_tests.py tests/integration/android/test_frida_flags.py
uv run scripts/run_integration_tests.py --appium 192.168.1.10             # another Appium server (default port 4723)
```

- With `-a`, the tests run once per device, one after another. The script then prints a summary and fails if any device failed.
- The Appium server is `--appium <ip>[:<port>]`, else `$APPIUM_URL`, else `127.0.0.1:4723`. The script stops right away if Appium isn't reachable.
- The tests need the target apps (`sync_target_apps.py`), a running frida-server (`prepare_android_devices.py`) and a current agent (`uv run compile-agent --dev && uv sync`).

Plain pytest works too. With several devices attached, set `ANDROID_SERIAL`:

```bash
ANDROID_SERIAL=emulator-5554 uv run pytest tests/integration/android -k receive_int
```

### platform_check.py

Runs every test suite on the host and on every device and writes a report. See [Checking a New Platform](#checking-a-new-platform).

```bash
uv run scripts/platform_check.py                                   # host and every attached device
uv run scripts/platform_check.py -s emulator-5554 --skip unit      # one device, without the host unit tests
uv run scripts/platform_check.py --skip agent -k receive_int       # only some integration tests
uv run scripts/platform_check.py --adb-host 192.168.1.20 --appium 192.168.1.20   # adb and Appium on another machine
```

The agent tests aren't in `scripts/`: run them with `npm run test:android` in `frooky/agent`, which takes `-- -s <serial>` or `-- -a` the same way (`frooky/agent/scripts/test-android.sh`).

## Checking a New Platform

To check frooky on a host OS, Android version or device it hasn't been tested on, run:

```bash
uv run scripts/platform_check.py
```

It records the host (OS, architecture, Python, Node, Frida) and each device (Android version, API level, architecture), builds the agent, runs the host unit tests, and then runs the agent tests and the Android integration tests on every attached device, one after another. `-s <serial>` checks only that device and can be repeated; `uv run scripts/list_android_devices.py` shows which serial belongs to which Android version and model. The report is written to `.platform-check/<timestamp>/report.md` with a section per device, together with the test results (`<serial>/`) and the full logs. Attach the folder to an issue or PR.

- Requires a running `frida-server` on each device: `uv run scripts/prepare_android_devices.py` installs and starts it.
- The integration tests also need Appium (`APPIUM_URL`) and the target apps: `uv run scripts/sync_target_apps.py` builds and installs them. Without them, the step is skipped and the report says why.
- On a device without the Google dialer, the agent tests run in `com.android.dialer`.
- `--skip unit,agent,integration` skips steps, `-k <pattern>` runs only the matching integration tests.
- `--adb-host <ip>[:<port>]` uses the adb server on another machine (default port 5037), `--appium <ip>[:<port>]` the Appium server (default: `$APPIUM_URL`, else `127.0.0.1:4723`), and `--out <dir>` writes the report elsewhere.

frooky only supports 64-bit app processes (`arm64`, `x86_64`). The agent refuses to start in a 32-bit process.

### CI

A push runs the tests on one configuration: Linux with Python 3.14 for the host unit tests, and an x86_64 emulator with API 34 for the agent and integration tests. To test the others, run the workflows manually under **Actions → Run workflow**:

- **Verify frooky host**: host unit tests on Linux, macOS and Windows, each with Python 3.12 and 3.14.
- **Test agent Android** and **Test host Android**: emulators with API 29, 31, 33, 34, 35 and 36, or the levels given as a comma-separated list, e.g. `36` or `29, 36`.
