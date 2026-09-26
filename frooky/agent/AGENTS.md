# Agent (TypeScript) notes

This is the Frida agent that runs inside the target process. It is compiled with `frida-compile` through `build.js`, which stages `src/android` + `src/shared` + `src/native` into a temp dir. Anything outside those folders is not part of the Android build.

## Layout

- `src/shared/`: platform-agnostic code: hook-file input types (`inputParsing/`), settings, events, decoder and hook base classes.
- `src/android/`: Java/Kotlin hooking via `frida-java-bridge`, plus Java decoders.
- `src/native/`: native (C/C++) hooking and decoders, shared across platforms.
- `src/FrookyAgent.ts`: entry class that wires validators, managers and the event sender together.

## Things that bite

- **Input vs. normalized types.** Hook files allow shorthands (`- getKeyPair`, `[type, name, {settings}]`). `src/shared/inputParsing/Input*` types describe those shorthands, and the `normalize*` functions turn them into the internal object form. Internal code only ever sees normalized objects. See `src/shared/inputParsing/README.md`.
- **Generated schemas.** `inputParsing/zodSchemas/*.zod.ts` come from `npm run build:zodSchema` (ts-to-zod, configured in `ts-to-zod.config.mjs`). The JSON schema in `docs/schema/` comes from `npm run build:jsonSchema`, which also strips fields that are required on normalized types but optional in YAML. Validate YAML against the JSON schema, not the raw Zod schema: the Zod schema requires the internal `type` discriminator, which is never written in YAML.
- **Settings are merged, not replaced.** Decoder and hook settings cascade file → group → hook → param. See `configValidator.ts` and `docs/additional-features.md#settings-precedence`.
- **Hot paths.** Hooks and decoders run on every intercepted call inside the target app. Cache `Java.use(...)` lookups and reflective results at module level (see `BundleDecoder.ts`), avoid per-call Frida↔Java round-trips, and respect `fastDecode`, `maxDepth` and `maxItems`.
- **Tests run in a live process.** `*.test.ts` files use `frida-test` (`describe`/`it`/`expect`) and execute inside `com.google.android.dialer` on the device, so `Java.use` works in them. They cannot run without a device.
- `node_modules` in the devcontainer is a Docker volume. If dependencies look wrong, run `npm ci` rather than deleting the folder.
