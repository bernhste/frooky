# Copilot Instructions for Frooky

## Project Overview

**Frooky** is a Frida-powered dynamic instrumentation tool for mobile app security testing on Android and iOS. It allows security testers to hook Java/Kotlin methods and native C/C++ functions using simple YAML hook files.

> [!NOTE]
> The codebase targets the feature set of frooky 1.0. Android hooking (Java/Kotlin + native) is implemented; iOS support is planned in the agent's build tooling (`android`/`ios` are both valid platforms for `build.js`) but there is currently no `frooky/agent/src/ios/` source and no iOS build/test npm scripts — treat iOS as not yet implemented unless you find evidence otherwise.

### Key Technologies

- **Languages**: Python (CLI/host; see `requires-python` in [`pyproject.toml`](../pyproject.toml)), TypeScript (Frida agent)
- **Frameworks**: Frida (dynamic instrumentation), Zod (runtime validation of hook files, schemas generated via `ts-to-zod`), setuptools (Python packaging)
- **Build Tools**: `frida-compile` via a custom orchestrator ([`frooky/agent/build.js`](../frooky/agent/build.js)), Python `build` module
- **Package Management**: pip (Python), npm (Node.js, use `npm ci`)

## Project Structure

```bash
frooky/
├── frooky/                              # Main Python package (the "host")
│   ├── __init__.py                      # Package initialization / version
│   ├── __main__.py                      # `python -m frooky` entry point
│   ├── cli.py                           # Argument parsing, CLI entry point
│   ├── frida_runner.py                  # Core logic: attach/spawn, agent injection, hook loading
│   ├── pp_hook_event.py                 # Pretty-printing of captured hook events
│   └── agent/                           # Frida agent (TypeScript)
│       ├── package.json                 # npm scripts & dependencies
│       ├── tsconfig.json                # TypeScript configuration
│       ├── build.js                     # Custom build orchestrator (compile/watch, hook injection)
│       ├── ts-to-zod.config.mjs         # Config for generating Zod schemas from TS types
│       ├── src/
│       │   ├── FrookyAgent.ts           # Agent entry class, wires validators/managers together
│       │   ├── android/                 # Android-specific hook implementation (Java/Kotlin)
│       │   │   ├── decoders/            # Android-specific value decoders
│       │   │   └── hook/                # Android hook manager/validator
│       │   ├── native/                  # Native (C/C++) hooking, cross-platform
│       │   │   ├── decoders/            # Native value/reference/type decoders
│       │   │   └── hook/                # Native hook manager/validator, float-arg handling
│       │   └── shared/                  # Platform-agnostic building blocks
│       │       ├── decoders/            # Base decoder interfaces
│       │       ├── event/               # Event model + async event sender
│       │       ├── hook/                # Generic hook manager/validator interfaces
│       │       └── inputParsing/        # Hook file input types + generated Zod schemas
│       ├── tests/                       # Agent unit tests (`*.test.ts`, run with frida-test)
│       └── dist/                        # Compiled agent artifacts (git-ignored)
│           ├── agent-android.js         # Built Android agent
│           └── version.json             # Version metadata (frida/bridge versions used)
├── docs/                                # Documentation
│   ├── develop.md                       # Development setup guide
│   ├── decoders.md, output.md, *-declaration.md  # Hook file format reference docs
│   └── examples/                        # Example hook files (YAML)
├── tests/
│   ├── unit/                            # Python unit tests (pytest, no device needed)
│   ├── integration/                     # Python integration tests (require a running emulator/device)
│   │   ├── android/
│   │   └── conftest.py
│   └── target-apps/                     # Native (C) fixtures + Android/iOS target apps used by tests
├── .github/
│   ├── actions/                         # Reusable composite actions (emulator + host test env setup)
│   ├── scripts/android/                 # Shell helpers used by CI (adb prep, frida-server install, Appium)
│   └── workflows/                       # CI/CD pipelines (see below)
├── pyproject.toml                       # Python project configuration (ruff, pytest, build config)
├── compileAgent.sh                      # Thin wrapper around `npm run build:{prod,dev}:android`
└── README.md                            # Main project documentation
```

## Build System & Workflow

### Two-Stage Build Process

Frooky uses a **two-stage build** that must be executed in order:

1. **Agent Compilation** (TypeScript → JavaScript):

   ```bash
   ./compileAgent.sh --prod    # Production build (minified), android only
   ./compileAgent.sh --dev     # Development build (unminified), android only
   ```
    - Runs `npm ci` inside [`frooky/agent/`](../frooky/agent/), then `npm run build:{prod,dev}:android`
    - Under the hood this calls `node build.js android [-c]`, which stages `src/android` + `src/shared` + `src/native` into a temp build dir, generates the hook-injection index file, and runs `frida-compile`
    - Outputs to [`frooky/agent/dist/`](../frooky/agent/dist/) as `agent-android.js` (+ `version.json`)
    - **CRITICAL**: Agent artifacts MUST exist before the Python package build

2. **Python Package Build**:

   ```bash
   python -m build
   ```
    - Packages the Python CLI/host and includes pre-built agent artifacts (see `tool.setuptools.package-data` in [`pyproject.toml`](../pyproject.toml))
    - Uses `setuptools-scm` for versioning from git tags
    - Outputs wheel (`.whl`) and source tarball (`.tar.gz`) to `dist/`

### Development Setup

To set up a local development environment:

```bash
# 1. Create and activate Python virtual environment
python3 -m venv venv
source venv/bin/activate

# 2. Compile the frooky agent
./compileAgent.sh --dev

# 3. Install CLI + dev dependencies in editable mode
pip install -e '.[dev]'

# 4. Verify installation
which frooky  # Should point to venv/bin/frooky
frooky --help
```

See [`docs/develop.md`](../docs/develop.md) for full details, including how to build/install Android and iOS target apps used by the test suites.

### Watch Mode for Active Development

For iterative agent development:

```bash
cd frooky/agent
npm run build:watch:android   # Auto-recompile on Android agent source changes
```

## Testing & CI/CD

The project has **two independently testable components**, each with its own test suite:

- **The agent (TypeScript)**: unit tests under [`frooky/agent/src/**/*.test.ts`](../frooky/agent/src) that run inside a live Frida session on an Android target, via `frida-test`. Run with:

  ```bash
  cd frooky/agent
  npm ci
  npm run test:android -- -U -f 'com.google.android.dialer'
  ```

- **The host (Python)**:
    - Unit tests: [`tests/unit/`](../tests/unit) — no device required, run with `pytest tests/unit`
    - Integration tests: [`tests/integration/`](../tests/integration) — require a running Android emulator/device with `frida-server` and the built target apps installed, run with `pytest tests/integration/android`

### CI Workflows ([`.github/workflows/`](workflows/))

- [`build-agent.yml`](workflows/build-agent.yml) — builds the agent (`npm run build:prod:android`), uploads `frooky-agent` artifact (reusable)
- [`build-host.yml`](workflows/build-host.yml) — depends on `build-agent`, builds the Python wheel/sdist, uploads `frooky-host` artifact (reusable)
- [`build-target-apps-android.yml`](workflows/build-target-apps-android.yml) — builds the Android target app(s) under `tests/target-apps/android` via `make` (reusable)
- [`test-host-unit.yml`](workflows/test-host-unit.yml) — compiles the agent (dev), installs `.[dev]`, runs `pytest tests/unit` (reusable)
- [`verify-host.yml`](workflows/verify-host.yml) — on push; builds the host, runs host unit tests, installs the built wheel and checks `frooky --help` works and agent artifacts are present in the wheel
- [`test-agent-android.yaml`](workflows/test-agent-android.yaml) — on push; runs the agent's `npm run test:android` against a GitHub Actions Android emulator
- [`test-host-android.yml`](workflows/test-host-android.yml) — on push; builds host + Android target apps, then runs `pytest tests/integration/android` against a GitHub Actions Android emulator (with Appium + frida-server installed)
- [`publish-host.yml`](workflows/publish-host.yml) — **currently disabled/commented out** (PyPI publish on `v*` tags); do not re-enable without explicit instruction
- [`sync-labels.yml`](workflows/sync-labels.yml) — repo label management, unrelated to build/test

### Running CI Checks Locally

```bash
# Agent build + host build (mimics CI)
./compileAgent.sh --prod
python -m build
python -m pip install dist/*.whl
frooky --help

# Verify agent artifacts in wheel
unzip -l dist/*.whl | grep "frooky/agent/dist/agent-android.js"

# Host unit tests
pip install -e '.[dev]'
pytest tests/unit

# Agent unit tests (requires a connected/attached Android target, see docs/develop.md)
cd frooky/agent && npm run test:android -- -U -f <bundle-id-or-process>
```

## Important Gotchas & Considerations

### 1. **Agent Artifacts Must Be Built First**

- **ALWAYS** run `./compileAgent.sh` before `python -m build`
- Python packaging will fail or produce incomplete artifacts if agents are missing
- The [`compileAgent.sh`](../compileAgent.sh) script must be executable (`chmod +x compileAgent.sh`)

### 2. **Version Management**

- Version is determined by `setuptools-scm` from git tags and commits
- Requires full git history: `git clone` without depth restrictions or fetch with `fetch-depth: 0` in CI
- Generated version file: `frooky/_version.py` (git-ignored, auto-created during build)
- **Do not manually edit version numbers**

### 3. **Node.js Environment**

- Node.js version is pinned to `24` in CI (see `actions/setup-node` steps in the workflows)
- Use `npm ci` (not `npm install`) for consistent dependency installation
- Package lock file is at [`frooky/agent/package-lock.json`](../frooky/agent/package-lock.json)
- Hook-file input types live in [`frooky/agent/src/shared/inputParsing/`](../frooky/agent/src/shared/inputParsing); their Zod counterparts under `zodSchemas/` are **generated** via `npm run build:zodSchema` (`ts-to-zod`) — edit the TS source types, not the generated `.zod.ts` files, then regenerate

### 4. **Python Version Compatibility**

- Minimum supported Python is defined by `requires-python` in [`pyproject.toml`](../pyproject.toml) (currently `>=3.10`)
- CI runs against Python `3.14` for build/test workflow steps
- Uses modern Python features (e.g., `from __future__ import annotations`)
- Lint/format via `ruff` (see `[tool.ruff]` in `pyproject.toml`); tests via `pytest` (see `[tool.pytest.ini_options]`)

### 5. **Frida Dependencies**

- Frida dependency constraints are defined in [`pyproject.toml`](../pyproject.toml) under `project.dependencies` (`frida`, `frida-tools`)
- These are system-dependent native packages that may take time to install
- The agent's Frida bridge versions (`frida-java-bridge`, `frida-swift-bridge`, `frida-objc-bridge`) are npm devDependencies in [`frooky/agent/package.json`](../frooky/agent/package.json) and get recorded into `dist/version.json` at build time

### 6. **Output Files**

- Default output: `output.json` (git-ignored)
- Output format: JSON Lines (NDJSON) - one JSON object per line
- Pretty-printing of events is handled by [`frooky/pp_hook_event.py`](../frooky/pp_hook_event.py)
- Use `jq . output.json` to pretty-print

### 7. **Git Pager Issues**

- **ALWAYS** use `git --no-pager` when running git commands programmatically
- Example: `git --no-pager status`, `git --no-pager diff`

## Common Tasks

### Modifying the Frida Agent

1. Edit TypeScript files in [`frooky/agent/src/android/`](../frooky/agent/src/android/) (Java/Kotlin hooking), [`frooky/agent/src/native/`](../frooky/agent/src/native/) (native C/C++ hooking, cross-platform), or [`frooky/agent/src/shared/`](../frooky/agent/src/shared/) (shared logic used by both)
2. Recompile: `cd frooky/agent && npm run build:dev:android`
3. If you changed input hook-file types under `shared/inputParsing/`, regenerate Zod schemas: `npm run build:zodSchema`
4. Add/update tests alongside the changed module (`*.test.ts`) and run `npm run test:android`
5. Test locally with `pip install -e .` and run `frooky` commands
6. Run `frooky --help` to make sure the agent scripts are properly compiled

### Modifying Python CLI/Host

1. Edit [`frooky/cli.py`](../frooky/cli.py), [`frooky/frida_runner.py`](../frooky/frida_runner.py), or [`frooky/pp_hook_event.py`](../frooky/pp_hook_event.py)
2. Changes are immediately available with `pip install -e .`
3. Add/update tests in [`tests/unit/`](../tests/unit) (and [`tests/integration/`](../tests/integration) if device-facing behavior changed)
4. Test with `frooky --help` or relevant commands, and `pytest tests/unit`

### Adding Dependencies

- **Python**: Add to `dependencies` (or `project.optional-dependencies.dev`) array in [`pyproject.toml`](../pyproject.toml)
- **Node.js**: Run `cd frooky/agent && npm install --save-dev <package>` (or without `--save-dev` for runtime deps like `zod`)

### Documentation Updates

- Main docs are in [`docs/`](../docs/) directory
- README.md provides quick start and the hook-file format overview
- Development guide: [`docs/develop.md`](../docs/develop.md)
- Hook-file field references: [`docs/decoders.md`](../docs/decoders.md), [`docs/output.md`](../docs/output.md), [`docs/java-hook-declaration.md`](../docs/java-hook-declaration.md), [`docs/native-hook-declaration.md`](../docs/native-hook-declaration.md), [`docs/parameter-declaration.md`](../docs/parameter-declaration.md), [`docs/return-type-declaration.md`](../docs/return-type-declaration.md)

### Adding/Modifying Examples

- Example hook files live in [`docs/examples/`](../docs/examples/)
- Add new examples to demonstrate a new feature; update existing ones if a feature or the public hook-file API changes

## Key Files to Understand

### Python Side (host)

- **[`frooky/cli.py`](../frooky/cli.py)**: Argument parsing (device selection, target selection, script/output options), CLI entry point
- **[`frooky/frida_runner.py`](../frooky/frida_runner.py)**: Core logic for loading hooks, attaching/spawning processes, injecting the compiled agent
- **[`frooky/pp_hook_event.py`](../frooky/pp_hook_event.py)**: Pretty-printing of captured hook events to the terminal
- **[`pyproject.toml`](../pyproject.toml)**: Project metadata, dependencies, build/lint/test configuration

### Agent Side (TypeScript)

- **[`frooky/agent/src/FrookyAgent.ts`](../frooky/agent/src/FrookyAgent.ts)**: Agent entry class; wires together the platform hook validator/manager, native hook manager, event sender, and logger
- **[`frooky/agent/build.js`](../frooky/agent/build.js)**: Custom build orchestrator (stages source, injects hook files for the `frida` target, invokes `frida-compile`, supports watch mode)
- **[`frooky/agent/src/android/`](../frooky/agent/src/android/)**: Android-specific hook implementations (Java/Kotlin, via `frida-java-bridge`)
- **[`frooky/agent/src/native/`](../frooky/agent/src/native/)**: Native (C/C++) hook implementations shared across platforms
- **[`frooky/agent/src/shared/`](../frooky/agent/src/shared/)**: Platform-agnostic hook/event/decoder interfaces and hook-file input parsing (incl. generated Zod schemas)
- **[`frooky/agent/package.json`](../frooky/agent/package.json)**: Frida bridge dependencies, npm build/test scripts

## Workflow for Code Changes

1. **Identify scope**: Python host, Android agent, native agent, shared agent code, docs, or examples?
2. **Set up dev environment**: Virtual env + compile agent
3. **Make changes**: Edit relevant files
4. **Rebuild as needed**:
    - Agent changes (android/native/shared): `cd frooky/agent && npm run build:dev:android`
    - Changed input hook-file types: `npm run build:zodSchema`
    - Python changes: No rebuild needed with `pip install -e .`
5. **Test**:
    - Agent: `npm run test:android` (requires an attached/spawnable Android target)
    - Host unit: `pytest tests/unit`
    - Host integration: `pytest tests/integration/android` (requires emulator/device + built target apps, see [`docs/develop.md`](../docs/develop.md))
6. **Verify CI would pass**: Run the local build + install verification steps above
7. **Update docs** if user-facing behavior or the hook-file format changes
8. **Update examples** in [`docs/examples/`](../docs/examples/) if relevant
9. **Update Copilot instructions** in [`.github/copilot-instructions.md`](copilot-instructions.md) if needed

## Platform-Specific Notes

### Android (implemented)

- Hooks Java/Kotlin methods using Frida's Java bridge (`frida-java-bridge`), implemented in [`frooky/agent/src/android/`](../frooky/agent/src/android/)
- Class names use Java notation, e.g. `android.security.keystore.KeyGenParameterSpec$Builder`
- Can hook constructors with the `$init` method name
- Also supports native (C/C++) hooking on Android via [`frooky/agent/src/native/`](../frooky/agent/src/native/)

### iOS (not yet implemented)

- `build.js` and `frooky/frida_runner.py` reference iOS as a target platform, and `tests/target-apps/ios/` exists for future test fixtures, but there is currently no `frooky/agent/src/ios/` source directory and no `build:*:ios` / `test:ios` npm scripts
- Do not assume iOS hooking works end-to-end; check current source/tests before implementing or documenting iOS-specific behavior

## Debugging Tips

- **Agent not loading**: Check that `frooky/agent/dist/` contains `agent-android.js` and is recent
- **Import errors**: Ensure you're using the venv Python (`which python`)
- **Frida connection issues**: Verify the target device has `frida-server` running (see [`.github/scripts/android/install-frida-server.sh`](../.github/scripts/android/install-frida-server.sh) for how CI does it)
- **Build failures**: Check Node.js version (needs 24+), ensure [`compileAgent.sh`](../compileAgent.sh) is executable
- **Hook file schema errors**: Input hook files are validated against Zod schemas generated from [`frooky/agent/src/shared/inputParsing/`](../frooky/agent/src/shared/inputParsing) — check `configValidator.ts` and the relevant `*.zod.ts` file
