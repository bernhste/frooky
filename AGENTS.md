# AGENTS.md

frooky is a Frida-based dynamic analysis tool for Android (and later iOS) apps. Users describe hooks in YAML hook files; frooky injects a TypeScript Frida agent into the target app and writes captured events as NDJSON.

Two components, each with its own build and tests:

- **Host** (`frooky/`, Python): CLI, device attach/spawn, loads hook files, writes `output.json`.
- **Agent** (`frooky/agent/`, TypeScript): runs inside the target process, validates hook files, installs hooks, decodes values. See [frooky/agent/AGENTS.md](frooky/agent/AGENTS.md).

## Target Platforms

Target platforms to support (keep cross-platform compatibility in mind so fixes on Linux x86_64 do not break macOS Apple Silicon / M1 environments and vice versa):

- Android devices (ARM64)
- Android Emulator (macOS ARM64, x86_64 on Debian)
- iOS devices (ARM64)
- iOS Simulator (ARM64)

## Commands

```bash
uv run compile-agent --dev                 # build agent -> frooky/agent/dist/agent-android.js (runs npm ci)
uv sync                                 # sync dependencies and install host in editable mode (.venv)
uv run pytest tests/unit                # host unit tests, no device needed
uv run ruff check . && uv run ruff format --check .   # Python lint/format (config in pyproject.toml)
uv run scripts/platform_check.py       # all tests on the host and every attached device (-s <serial> for one), writes a report (docs/develop.md)
uv run scripts/list_android_devices.py      # serial, Android version, API level, ABI and model of every attached device
uv run scripts/prepare_android_devices.py   # root, SELinux permissive, install and start frida-server on all attached devices (-s <serial> for one)
uv run scripts/sync_target_apps.py     # build the target apps and install the latest build on all attached devices (-c clean build)

cd frooky/agent
npm run build:dev:android               # rebuild agent only
npm run build:zodSchema                 # regenerate Zod schemas after changing hook-file types
npm run build:jsonSchema                # regenerate docs/schema/frooky-config.schema.json
npm run test:android                    # agent tests on the only attached device; -- -s <serial> for one of several, -- -a for every device
npm run build:watch:android             # standalone agent with hook files embedded, for use with the plain `frida` CLI
```

Adding dependencies: Python: `uv add <pkg>` or `uv add --dev <pkg>` (managed in `pyproject.toml` and `uv.lock`). Node: `cd frooky/agent && npm install --save-dev <pkg>`; use no `--save-dev` for runtime dependencies like `zod`, which get bundled into the agent.

CI (`.github/workflows/`) runs on every push: `verify-host.yml` (wheel build, unit tests, checks the agent is in the wheel), `test-agent-android.yaml` (agent tests on an emulator), and `test-host-android.yml` (integration tests on an emulator with Appium).

Tests that need a device (`npm run test:android`, `pytest tests/integration/android`) are covered by the `device-testing` skill. In the devcontainer, adb, Appium and frida-server run on the host and are reached via `ADB_SERVER_SOCKET`, `APPIUM_URL` and `FRIDA_HOST`. Check `adb devices` before assuming a device is available. If none is, say so instead of skipping tests silently.

## Testing Guide

- **Always run `npm run test:android` when changing the agent** (`frooky/agent/`): runs TypeScript agent unit tests inside `com.google.android.dialer` on the device, or `com.android.dialer` where the Google dialer is missing (`FRIDA_TEST_APP=<package>` for another app). With several devices attached, pass `-- -s <serial>` (or set `ANDROID_SERIAL`) for one, or `-- -a` to run on each. Recompile first (`npm run build:dev:android` or `uv run compile-agent --dev`).
- **Always run Python unit tests when changing Python host code** (`frooky/`, `tests/unit/`): run `uv run pytest tests/unit` (no device required) and check formatting/linting via `uv run ruff check . && uv run ruff format --check .`.
- **Only run affected integration tests when agent or host changes**: integration tests (`pytest tests/integration/android`) use Appium and test apps; only run the specific tests affected by the change (e.g. `uv run scripts/run_integration_tests.py -k <pattern>`, with `-s <serial>` for one of several devices, `-a` for all and `--appium <ip>[:<port>]`, default `$APPIUM_URL`, else `127.0.0.1:4723`) rather than the entire test suite.

## Target Apps

The integration tests and the examples in `docs/examples/` run against our own test apps in `tests/target-apps/android/<app>/` (`value-passing-java`, `value-passing-native`). Test frooky against these, not against system libraries or third-party apps: a situation a test needs (e.g. a call from a library constructor, a deep call chain, a class loader) belongs in a target app.

- **Sources:** `MastgTest.kt`, `cpp/*.c` with `cpp/CMakeLists.txt`, `build.gradle.kts.*` and the app's `README.md`, which lists what each function or method is for. `<app>/build/` is a generated clone of the base app and `dist/` holds the APKs; both are gitignored, never edit them.
- **Rebuild and reinstall with `uv run scripts/sync_target_apps.py`** (or the Makefile it calls), never with Gradle or `adb` directly. It builds all apps, compares each device's installed APK with `dist/<app>.apk` and reinstalls the ones that are missing or differ, on every attached device. Pass app names or `-s <serial>` to narrow it down, and `-c` for a clean build after changing `build.gradle.kts.*` or `AndroidManifest.xml` or removing a source file. With the Makefile, `make install` only installs the last built APK, so build first, and uninstall the old app so nothing of the old build remains (`ANDROID_SERIAL` picks the device):

  ```bash
  cd tests/target-apps/android
  make build TARGET_APP=<app>        # copies the sources into <app>/build/, runs Gradle, writes dist/<app>.apk
  make uninstall TARGET_APP=<app>
  make install TARGET_APP=<app>
  # all apps: make build-all, make uninstall-all, make install-all; remove a build: make clean TARGET_APP=<app>
  ```

- **Adding a test situation:** add the method or function to the target app, with a comment on what it's for, and list it in the app's `README.md`. Then add or extend the example in `docs/examples/` with its `# Expected` events and the test in `tests/integration/android/test_examples.py` (see Conventions). Assert on the app's own values and frames, e.g. `JNI_OnLoad+0x... (libloadTime.so:...)` or `org.owasp.mastestapp.MastgTest...`, not on frames of the linker, ART or the Android framework, which differ between Android versions.
- **After changing a native app**, check its functions' offsets with the `update-native-offsets` skill and run the integration tests of that app.

## Rules

- **Build order:** the agent must be compiled before `uv build`; the wheel bundles `frooky/agent/dist/`. A stale `dist/` means the host runs old agent code, so rebuild after any agent change before testing through `frooky`.
- **Generated files, never edit by hand:**
  - `frooky/agent/src/shared/inputParsing/zodSchemas/*.zod.ts`: edit the TS types, then `npm run build:zodSchema`.
  - `docs/schema/frooky-config.schema.json`: `npm run build:jsonSchema` (post-processed by `frooky/agent/scripts/generateJsonSchema.ts`). VS Code uses it for YAML autocompletion.
  - `frooky/_version.py`: from git tags via setuptools-scm. Never edit version numbers.
- **The hook-file format is the public API.** Any change to it must update the types, both generated schemas, `docs/*.md`, `docs/examples/`, and the README. Use the `change-hook-schema` skill.
- **iOS is not implemented.** There is no `frooky/agent/src/ios/` and there are no iOS npm scripts. Don't claim or document iOS behavior without evidence in the source.
- `.github/workflows/publish-host.yml` publishing is disabled. Don't re-enable it unless asked.
- Use `npm ci`, not `npm install`, unless you are adding a dependency. CI uses Node 24 and Python 3.14; minimum Python is 3.12 (Ubuntu 24.04 LTS).
- Use `git --no-pager` for git commands.
- **No git commits/pushes:** Never run `git commit` or `git push`. Only inspect changes (`git status`, `git diff`). All staging, committing, and pushing is done by the user.

## Conventions

- Python: ruff, double quotes, `from __future__ import annotations`. Host unit tests live in `tests/unit/` and mirror the module layout.
- TypeScript: Prettier (`.prettierrc`); tests sit next to the code as `*.test.ts`.
- Docs: Markdown in `docs/` with markdownlint (`.markdownlint.json`). Every hook-file feature has an example in `docs/examples/` with a `# Docs:` link to the upstream API.
- Examples in `docs/examples/<platform>/<topic>/` run against the target apps and document their events in `# Expected` comments; `tests/integration/android/test_examples.py` checks them. Change both together, and add methods or functions to the target apps when an example needs them. Changing a native target app moves its functions, so update the examples' `offset:` hooks afterwards (`update-native-offsets` skill).
- Code comments:
  - Only comment what the code doesn't say itself: why, non-obvious constraints, units, formats. No comments that restate the next line (`// decode the return value`) and no commented-out code.
  - Describe the current behavior. Never reference old behavior, fixed bugs or how the code got there ("used to", "regression", "previously", "instead of the old ..."), and leave that out of test names too. Bugfix context belongs in the commit message.
  - Keep it short and technical, usually one or two lines. Give an example when it's clearer than prose, e.g. `` // e.g. `libfoo.so!open` or `libfoo.so+0x1a2b4` ``.
  - TypeScript: use plain `//` comments above functions, types and fields. JSDoc (`/** */`) only for the public hook-file input types (`frookyConfig.ts`, `frookyMetadata.ts`, `frookySettings.ts`, `decoders/decodable.ts`, `inputParsing/input*.ts`), which document the YAML format. There, no `@param`/`@returns` blocks either.
- Output events are NDJSON; each line is a JSON object (one event per line). See `docs/output.md`.

## Debugging

- **Agent changes have no effect:** `frooky/agent/dist/agent-android.js` is stale. Rebuild it.
- **Import errors or the wrong `frooky`:** `which frooky` must point into the venv, not a global install.
- **Hook file rejected:** validate it against `docs/schema/frooky-config.schema.json` (see the `write-hook-file` skill). Runtime validation happens in `frooky/agent/src/shared/configValidator.ts` and the platform `*HookValidator.ts` files.
- **Hooks not firing:** run `frooky -vv` for agent debug logs. Hooks whose class or module hasn't loaded show up as `waiting` in the status bar; they are installed when it loads, so a waiting hook usually means a misspelled name or code the app hasn't run yet.
- **Cannot connect or cannot hook:** check each layer in order:

  ```bash
  adb devices                                  # 1. device listed as "device" (not "offline"/"unauthorized")
  adb shell 'ps -A | grep -i frida'            # 2. frida-server runs (binary may be named e.g. frida-server-17.17.0)
  frida-ps -U | head -3                        # 3. host frida can talk to it (lists processes)
  frida --version                              # 4. compare with the server version:
  adb shell 'for f in /data/local/tmp/frida-server*; do $f --version; done'
  frida-ps -Uai | grep <package>               # 5. target app installed ("-" in the PID column = not running)
  adb shell pidof <package>                    # 6. app running, only needed for attach (-n/-p), not spawn (-f)
  ```

  If step 2 or 3 fails, run `uv run scripts/prepare_android_devices.py`: it installs and starts the newest frida-server with the host frida's major version. A server of another major version can't talk to the host, and an older server can crash the app on newer Android versions. Test apps install with `uv run scripts/sync_target_apps.py`; their package ids are `<app with - replaced by _>.frooky.target.app`.

## Skills

Task-specific instructions live in `.agents/skills/<name>/SKILL.md` (the [Agent Skills](https://agentskills.io) format; `.claude/skills` is a symlink to the same folder). **Before starting a task that matches one of these, read its `SKILL.md` in full and follow it**, even if your tool doesn't load skills automatically:

- [`change-hook-schema`](.agents/skills/change-hook-schema/SKILL.md): add or change a field in the hook-file format.
- [`add-decoder`](.agents/skills/add-decoder/SKILL.md): add a Java or native value decoder.
- [`device-testing`](.agents/skills/device-testing/SKILL.md): run agent and integration tests against an emulator or device.
- [`write-hook-file`](.agents/skills/write-hook-file/SKILL.md): write or review a frooky hook YAML for a given API, and validate it.
- [`update-native-offsets`](.agents/skills/update-native-offsets/SKILL.md): update the hardcoded `offset:` values in `docs/examples` after changing or rebuilding a native target app.
