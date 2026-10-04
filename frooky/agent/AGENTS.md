# Agent (TypeScript) notes

This is the Frida agent that runs inside the target process. It is compiled with `frida-compile` through `build.js`, which stages `src/android` + `src/shared` + `src/native` into a temp dir. Anything outside those folders is not part of the Android build.

## Target Platforms

Target platforms to support (ensure changes remain compatible across Linux x86_64 and macOS Apple Silicon / M1):

- Android devices (ARM64)
- Android Emulator (macOS ARM64, x86_64)
- iOS devices (ARM64)
- iOS Simulator (ARM64)
- Linux x86_64 (Debian)

## Layout

- `src/shared/`: platform-agnostic code: hook-file input types (`inputParsing/`), settings, events, decoder and hook base classes.
- `src/android/`: Java/Kotlin hooking via `frida-java-bridge`, plus Java decoders.
- `src/native/`: native (C/C++) hooking and decoders, shared across platforms.
- `src/FrookyAgent.ts`: entry class that wires validators, managers and the event sender together.

## Things that bite

- **Input vs. normalized types.** Hook files allow shorthands (`- getKeyPair`, `[type, name, {settings}]`) and partial settings. `src/shared/inputParsing/Input*` types describe them and generate the schemas. The validators check each hook against its input schema, then the `normalize*` functions turn it into a `JavaHookDeclaration` or `NativeHookDeclaration` (`src/shared/hook/hookDeclaration.ts`) with complete settings. Internal code only ever sees these. Never reuse a normalized type in an input type. See `src/shared/inputParsing/README.md`.
- **Generated schemas.** `inputParsing/zodSchemas/*.zod.ts` come from `npm run build:zodSchema` (ts-to-zod, configured in `ts-to-zod.config.mjs`). The JSON schema in `docs/schema/` comes from `npm run build:jsonSchema`. Validate YAML against the JSON schema, not the raw Zod schema: the Zod schema requires the internal `type` discriminator, which is never written in YAML.
- **Settings are merged, not replaced.** Decoder and hook settings cascade file → group → hook → param. See `configValidator.ts` and `docs/additional-features.md#settings-precedence`.
- **Hot paths.** Hooks and decoders run on every intercepted call inside the target app. Cache `Java.use(...)` lookups and reflective results at module level (see `BundleDecoder.ts`), avoid per-call Frida↔Java round-trips, and respect `maxDepth` and `maxItems`.
- **Tests run in a live process.** `*.test.ts` files use `frida-test` (`describe`/`it`/`expect`) and execute inside `com.google.android.dialer` on the device (`com.android.dialer` where the Google dialer is missing), so `Java.use` works in them. They cannot run without a device. Always run them with `npm run test:android` when changing agent code; with several devices attached, add `-- -s <serial>` for one or `-- -a` for each (`scripts/test-android.sh`).
- `node_modules` in the devcontainer is a Docker volume. If dependencies look wrong, run `npm ci` rather than deleting the folder.
