---
name: add-decoder
description: Use when adding or changing a frooky value decoder, meaning how a Java object (e.g. an Android class like Intent or Bundle, a Java interface like Map) or a native type is turned into structured output in hook events. Also for adding a named custom decoder selectable via `decoder:` in hook files.
---

# Adding a decoder

All decoders extend `Decoder<T>` from `frooky/agent/src/shared/decoders/baseDecoder.ts`. They get a `Decodable` (`type`, `name`, `settings`, optional `declaringClass`) and implement `decode(value): DecodedValue`.

First decide which kind you need:

| Kind | Chosen when | Register in |
|---|---|---|
| **Java class decoder** | The runtime class of a value equals a specific class | `classDecoderRegistry` in `frooky/agent/src/android/decoders/builtin/ReferenceTypeDecoder.ts` |
| **Java interface decoder** | The runtime class implements an interface (e.g. `java.util.Map`) | `interfaceDecoderRegistry` in the same file |
| **Named custom decoder** | The user opts in with `decoder: <name>` in the hook file | `CUSTOM_DECODER_REGISTRY` in `frooky/agent/src/android/decoders/javaDecoderResolver.ts` |
| **Native decoder** | Native parameter or return types | `frooky/agent/src/native/decoders/nativeDecoderResolver.ts` / `nativeFridaType.ts` |

Primitives, `java.lang.String`, `void` and arrays are handled by `PrimitiveDecoder` and `ArrayDecoder` before the registries are consulted.

## Java class and interface decoders

1. Put the file in a folder that mirrors the Java package: `frooky/agent/src/android/decoders/<package path>/<SimpleName>Decoder.ts`. Examples: `android/os/BundleDecoder.ts`, `java/util/MapDecoder.ts`.
2. Model the implementation on an existing one. `android/os/BundleDecoder.ts` shows the performance patterns to follow:
   - Cache `Java.use(...)` wrappers and reflective lookups at module level. `decode()` runs on every hooked call inside the target app.
   - Decode nested values by delegating to `JavaDecoderResolver.resolveDecoder(...)` or `ReferenceTypeDecoder`, passing `this.settings` along. Don't reimplement primitive or array handling.
   - Respect `settings.maxItems` (append `"[truncated at N]"`) and `settings.maxDepth`. If there's a cheaper, less detailed path, use it when `settings.fastDecode` is set.
   - Handle `null` and falsy values (`0`, `false`) explicitly. Earlier regressions treated them as absent.
   - Return `long` values as decimal strings to avoid precision loss.
3. Register the decoder with its fully qualified class name. Inner classes use `$`, e.g. `android.content.ClipData$Item`.
4. Add `<SimpleName>Decoder.test.ts` next to the decoder. Build real objects with `Java.use(...).$new()` (tests run inside a live Android process) and assert on the exact `DecodedValue`. Cover empty, null, truncation and nested cases.

## Named custom decoders

Same implementation rules as above. After adding the entry to `CUSTOM_DECODER_REGISTRY`, **update the list of registered decoders in `docs/decoders.md`** (the "`decoder`: Override the Default Decoder" note). Hook files reference decoders by these names, and the JSON schema does not check them.

If the decoder needs context from another argument, it receives it via `decoderArg` (the `arg` parameter of `decode`).

## Native decoders

Type parsing lives in `nativeFridaType.ts`. Values are handled by `NativeValueDecoder` (fundamental types) or `NativeReferenceDecoder` (pointers), with `NativeFallbackDecoder` for anything else. Extend the parser or the reference decoder there, and add cases to the matching `*.test.ts`. For behavior visible in the target app, also add a function to `tests/target-apps/android/value-passing-native` and a test in `tests/integration/android/test_value_passing_native.py`.

## Finish

1. Build: `cd frooky/agent && npm run build:dev:android`.
2. Test on a device: `npm run test:android` (see the `device-testing` skill). If no device is available, say that the new tests were not run.
3. Update `docs/decoders.md` if user-visible output changed. If the new decoder is worth showing, add a hook to `docs/examples/01_android.yaml` that exercises it.
