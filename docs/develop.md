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

After building, the app must be installed manually on the device or simulator before running tests. This command will install and launch the app:

```bash
cd tests/target-apps/<android|ios>
make install
```

> [!NOTE]
> Before proceeding, make sure Frida is available on the target device (Android) or on the local machine (iOS Simulator).

### Running Agent Tests

The Frida agent has its own test suite that runs inside a live Frida session (on a real device, simulator, or emulator). Tests are written in TypeScript and live under `frooky/agent/tests/`.

All test commands must be run from the `frooky/agent/` directory with Node.js dependencies installed:

```bash
cd frooky/agent
npm ci
```

You only need to do this once (or after updating `package-lock.json`).

In general, you need to have either the PID (attach), bundle-id (spawn then attach), or app name (attach by name).

#### Option A: USB Device (Android and iOS)

Use this when the app is running on a device connected over USB with `frida-server` running on the device (or with a Frida gadget embedded in the app).

```bash
# Examples: Target is an physical or emulated Android:
npm run test:android -i org.owasp.mastestapp
npm run test:android -i MASTestApp
npm run test:android -i 4926

# Examples: Target is a physical iOS USB device mode:
npm run test:ios:usb -i org.owasp.mastestapp.MASTestApp-iOS
npm run test:ios:usb -i MASTestApp
npm run test:ios:usb -i 23452
```

#### Option B: Local (iOS Simulator only)

Use this when targeting an **iOS Simulator** on your Mac via the local device.

Compared to option A, this differs, because the target app in an iOS simulator is running as local process on the host system. This means, that there is no need to start a dedicated Frida server.

Use the following commands to test against the running simulator:

```bash
# Examples: Target is an physical or emulated Android:
npm run test:android:usb -i org.owasp.mastestapp
npm run test:android:usb -i MASTestApp
npm run test:android:usb -i 4926

# Examples: Target is a iOS simulator:
npm run test:ios:local -i org.owasp.mastestapp.MASTestApp-iOS
npm run test:ios:local -i MASTestApp
npm run test:ios:local -i 23452
```

### What the Tests Do

Each test script:

1. Builds the agent and the test agent bundle (`dist/agent-test-{platform}.js`).
2. Attaches to (or spawns) the target app via Frida.
3. Injects the test bundle into the live process.
4. The bundle runs all registered `test(...)` cases inside the process and sends results back.
5. Results are printed to the terminal; the process exits with code `0` (all pass) or `1` (any failure).

### Test File Structure

```sh
frooky/agent/tests/
├── agent-test-framework.ts   # Minimal test runner (test/expect API)
├── target-apps/              # Folder of apps in the form of MASTG-DEMO apps
├── android/
│   ├── agent-runner.ts       # Entry point injected into the Android app
│   └── test-*.ts             # Tests
└── ios/
    ├── agent-runner.ts       # Entry point injected into the iOS app
    └── test-*.ts             # Tests
```

To add a new test, create a `test-*.ts` file in the relevant platform folder and import it in `agent-runner.ts`.
