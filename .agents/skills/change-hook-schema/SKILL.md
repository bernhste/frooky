---
name: change-hook-schema
description: Use when adding, renaming, or removing a field or shorthand in the frooky hook-file (YAML) format, including metadata, settings, hookSettings/decoderSettings, java or native hook declarations, params and retType. Covers regenerating the Zod and JSON schemas and updating docs and examples.
---

# Changing the hook-file format

The hook-file format is frooky's public API. A change is only complete when every item below is updated. Missing one leaves VS Code autocompletion, the docs, or runtime validation out of sync.

## 1. Edit the source types (the only hand-written schema)

| What you change | File |
|---|---|
| Top level (`metadata`, `settings`, `hookCollection`) | `frooky/agent/src/shared/frookyConfig.ts` |
| Metadata fields | `frooky/agent/src/shared/frookyMetadata.ts` |
| Normalized settings (`DecoderSettings`, `HookSettings`) | `frooky/agent/src/shared/frookySettings.ts`, with defaults in `defaultValues.ts` |
| YAML shorthands for settings | `frooky/agent/src/shared/inputParsing/inputSettings.ts` |
| Java hook declarations | `frooky/agent/src/shared/inputParsing/inputJavaHookCollection.ts` |
| Native hook declarations | `frooky/agent/src/shared/inputParsing/inputNativeHookCollection.ts` |
| Params / retType shorthands | `frooky/agent/src/shared/inputParsing/inputDecodableTypes.ts` |

Input types allow shorthands. Every new shorthand needs a matching branch in the `normalize*` function in the same file, so that internal code only ever sees the normalized object form. Add a case to the neighboring `*.test.ts`.

If you add a new source file with types, register it in `frooky/agent/ts-to-zod.config.mjs`.

## 2. Regenerate the schemas (never hand-edit the outputs)

```bash
cd frooky/agent
npm run build:zodSchema    # -> src/shared/inputParsing/zodSchemas/*.zod.ts
npm run build:jsonSchema   # -> docs/schema/frooky-config.schema.json
```

`scripts/generateJsonSchema.ts` post-processes the JSON schema. It strips the internal `type` discriminator, the inherited `javaClass`/`module` on individual hooks, and the `required` lists on settings objects. It detects settings objects by their exact key sets (`decoderSettingsKeys`, `hookSettingsKeys`), so **if you add a decoder or hook setting, add its key to those lists**. Otherwise every settings object becomes "required" in the schema and real hook files fail validation.

## 3. Wire up runtime behavior

- Settings: `frooky/agent/src/shared/configValidator.ts` (merge and repair of partial settings).
- Java: `frooky/agent/src/android/hook/androidHookValidator.ts` and `androidHookManager.ts`.
- Native: `frooky/agent/src/native/hook/nativeHookValidator.ts` and `nativeHookManager.ts`.
- If the change affects emitted events, update the event types in `src/shared/event/`, the host's pretty printer `frooky/pp_hook_event.py`, and `docs/output.md`.

## 4. Docs and examples

- The reference page for the area you changed: `docs/java-hook-declaration.md`, `docs/native-hook-declaration.md`, `docs/parameter-declaration.md`, `docs/return-type-declaration.md`, `docs/decoders.md`, or `docs/additional-features.md` (settings precedence and hook settings tables).
- The README "Structure of a Hook File" section, if the top-level shape changed.
- `docs/examples/`: add or adjust an example with a `# Docs:` link to the upstream API. For settings, also update `docs/examples/setting_tests_{android,native}/`.
- On a rename, grep for the old name across `docs/`, `README.md`, `tests/` and `frooky/`. Old names tend to survive in prose and example YAML.

## 5. Verify

```bash
cd frooky/agent && npm run build:dev:android              # still compiles
node .agents/skills/write-hook-file/validate.cjs docs/examples/*.yaml docs/examples/*/*.yaml   # from repo root: all OK
pytest tests/unit
```

If a device is available, run the agent tests and the relevant integration test (see the `device-testing` skill). Integration tests in `tests/integration/android/` embed real YAML, so add a case there for user-visible behavior.
