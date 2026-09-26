# AGENTS.md

frooky is a Frida-based dynamic analysis tool for Android (and later iOS) apps. Users describe hooks in YAML hook files; frooky injects a TypeScript Frida agent into the target app and writes captured events as NDJSON.

Two components, each with its own build and tests:

- **Host** (`frooky/`, Python): CLI, device attach/spawn, loads hook files, writes `output.json`.
- **Agent** (`frooky/agent/`, TypeScript): runs inside the target process, validates hook files, installs hooks, decodes values. See [frooky/agent/AGENTS.md](frooky/agent/AGENTS.md).

## Commands

```bash
./compileAgent.sh --dev                 # build agent -> frooky/agent/dist/agent-android.js (runs npm ci)
pip install -e '.[dev]'                 # host in editable mode (devcontainer venv: /opt/venv)
pytest tests/unit                       # host unit tests, no device needed
ruff check . && ruff format --check .   # Python lint/format (config in pyproject.toml)

cd frooky/agent
npm run build:dev:android               # rebuild agent only
npm run build:zodSchema                 # regenerate Zod schemas after changing hook-file types
npm run build:jsonSchema                # regenerate docs/schema/frooky-config.schema.json
npm run test:android                    # agent tests, needs a device (see below)
npm run build:watch:android             # standalone agent with hook files embedded, for use with the plain `frida` CLI
```

Adding dependencies: Python goes in `pyproject.toml` (`dependencies` or `optional-dependencies.dev`). Node: `cd frooky/agent && npm install --save-dev <pkg>`; use no `--save-dev` for runtime dependencies like `zod`, which get bundled into the agent.

CI (`.github/workflows/`) runs on every push: `verify-host.yml` (wheel build, unit tests, checks the agent is in the wheel), `test-agent-android.yaml` (agent tests on an emulator), and `test-host-android.yml` (integration tests on an emulator with Appium).

Tests that need a device (`npm run test:android`, `pytest tests/integration/android`) are covered by the `device-testing` skill. In the devcontainer, adb, Appium and frida-server run on the host and are reached via `ADB_SERVER_SOCKET`, `APPIUM_URL` and `FRIDA_HOST`. Check `adb devices` before assuming a device is available. If none is, say so instead of skipping tests silently.

## Rules

- **Build order:** the agent must be compiled before `python -m build`; the wheel bundles `frooky/agent/dist/`. A stale `dist/` means the host runs old agent code, so rebuild after any agent change before testing through `frooky`.
- **Generated files, never edit by hand:**
  - `frooky/agent/src/shared/inputParsing/zodSchemas/*.zod.ts`: edit the TS types, then `npm run build:zodSchema`.
  - `docs/schema/frooky-config.schema.json`: `npm run build:jsonSchema` (post-processed by `frooky/agent/scripts/generateJsonSchema.ts`). VS Code uses it for YAML autocompletion.
  - `frooky/_version.py`: from git tags via setuptools-scm. Never edit version numbers.
- **The hook-file format is the public API.** Any change to it must update the types, both generated schemas, `docs/*.md`, `docs/examples/`, and the README. Use the `change-hook-schema` skill.
- **iOS is not implemented.** There is no `frooky/agent/src/ios/` and there are no iOS npm scripts. Don't claim or document iOS behavior without evidence in the source.
- `.github/workflows/publish-host.yml` publishing is disabled. Don't re-enable it unless asked.
- Use `npm ci`, not `npm install`, unless you are adding a dependency. CI uses Node 24 and Python 3.14; minimum Python is 3.10.
- Use `git --no-pager` for git commands.

## Conventions

- Python: ruff, double quotes, `from __future__ import annotations`. Host unit tests live in `tests/unit/` and mirror the module layout.
- TypeScript: Prettier (`.prettierrc`); tests sit next to the code as `*.test.ts`.
- Docs: Markdown in `docs/` with markdownlint (`.markdownlint.json`). Every hook-file feature has an example in `docs/examples/` with a `# Docs:` link to the upstream API.
- Output events are NDJSON; each line is a JSON **array** (a batch of events), not a single object. See `docs/output.md`.

## Debugging

- **Agent changes have no effect:** `frooky/agent/dist/agent-android.js` is stale. Rebuild it.
- **Import errors or the wrong `frooky`:** `which frooky` must point into the venv, not a global install.
- **Hook file rejected:** validate it against `docs/schema/frooky-config.schema.json` (see the `write-hook-file` skill). Runtime validation happens in `frooky/agent/src/shared/configValidator.ts` and the platform `*HookValidator.ts` files.
- **Hooks not firing:** run `frooky -vv` for agent debug logs, and increase `-t` if classes or modules load late.
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

  If step 2 fails, start frida-server (see the `device-testing` skill). If step 3 fails while step 2 passes, the most likely cause is a client/server version mismatch; install a frida-server matching `frida --version`. Test apps install from `tests/target-apps/android` with `make install TARGET_APP=<app>`; their package ids are `<app with - replaced by _>.frooky.target.app`.

## Skills

Task-specific instructions live in `.agents/skills/<name>/SKILL.md` (the [Agent Skills](https://agentskills.io) format; `.claude/skills` is a symlink to the same folder). **Before starting a task that matches one of these, read its `SKILL.md` in full and follow it**, even if your tool doesn't load skills automatically:

- [`change-hook-schema`](.agents/skills/change-hook-schema/SKILL.md): add or change a field in the hook-file format.
- [`add-decoder`](.agents/skills/add-decoder/SKILL.md): add a Java or native value decoder.
- [`device-testing`](.agents/skills/device-testing/SKILL.md): run agent and integration tests against an emulator or device.
- [`write-hook-file`](.agents/skills/write-hook-file/SKILL.md): write or review a frooky hook YAML for a given API, and validate it.
