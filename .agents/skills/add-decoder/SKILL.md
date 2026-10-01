---
name: add-decoder
description: Use when adding or changing a frooky value decoder, meaning how a Java object (e.g. an Android class like Intent or Bundle, a Java interface like Map) or a native type is turned into structured output in hook events. Also for adding a named custom decoder selectable via `decoder:` in hook files.
---

# Adding a decoder

All decoders extend `Decoder<T>` from `frooky/agent/src/shared/decoders/baseDecoder.ts`. They get a `Decodable` (`type`, `name`, `settings`, optional `declaringClass`) and implement `decode(value): DecodedValue`.

Every decoder sets `readonly decoderName = "<ClassName>"` (required; log messages use it because release builds minify class names) and, if the name alone doesn't say what it does, a one-sentence `readonly description`.

First decide which kind you need:

| Kind | Chosen when | Register in |
|---|---|---|
| **Java class decoder** | The runtime class of a value, or its nearest superclass, is a specific class | `classDecoderRegistry` in `frooky/agent/src/android/decoders/builtin/ReferenceTypeDecoder.ts` |
| **Java interface decoder** | The runtime class implements an interface (e.g. `java.util.Map`) and has no class decoder | `interfaceDecoderRegistry` in the same file (ordered, see below) |
| **Named custom decoder** | The user opts in with `decoder: <name>` in the hook file | `CUSTOM_DECODER_REGISTRY` in `frooky/agent/src/android/decoders/javaDecoderResolver.ts` |
| **Native decoder** | Native parameter or return types | `frooky/agent/src/native/decoders/nativeDecoderResolver.ts` / `nativeFridaType.ts` |

Primitives, `java.lang.String`, `void` and arrays are handled by `PrimitiveDecoder` and `ArrayDecoder` before the registries are consulted.

The resolution order is documented in `docs/decoders-java.md` ("How frooky Picks a Decoder"): `decoder:` from the settings, then a class decoder of the runtime class or a superclass, then the most specific implemented interface, then `toString()`. The interface registry is an ordered list: among unrelated interfaces the earlier entry wins, so place a new interface decoder by how much its output tells about the value. An interface that extends a registered one (e.g. `java.util.Collection` under `java.lang.Iterable`) wins over it regardless of the order. A class decoder is also used for subclasses: if it reflects getters, pass the registered class to `GetterDecoder` or `decodeGetterValues()` (see `IntentDecoder`), otherwise only the subclass's own getters are called.

## Java class and interface decoders

1. Put the file in a folder that mirrors the Java package: `frooky/agent/src/android/decoders/<package path>/<SimpleName>Decoder.ts`. Examples: `android/os/BundleDecoder.ts`, `java/util/MapDecoder.ts`.
2. Model the implementation on an existing one. `android/os/BundleDecoder.ts` shows the performance patterns to follow:
   - Cache `Java.use(...)` wrappers and reflective lookups at module level (`useJavaClass()` in `utils/javaValues.ts`). `decode()` runs on every hooked call inside the target app.
   - For an object with fixed fields, return a plain object built with `decodeFields()` from `utils/javaValues.ts`, which turns a getter that throws into `null` (see `javax/crypto/CipherDecoder.ts`). For byte arrays use `javaBytesToHex()`, for fingerprints `javaBytesSha256()`. For a decoder based on getters, call `decodeGetterValues()` with `GetterOptions` (class to reflect, prefixes, inherited getters, `byte[]` as hex), as `java/security/spec/SpecDecoder.ts` does.
   - Cast the value (`Java.cast`) to the class or interface that declares the methods you call. The wrapper can be typed as a supertype, and a wrapper only has the overloads its class declares (e.g. `ByteBuffer` has `position(int)`, but `position()` is on `Buffer`), and an interface wrapper lacks the methods of its superinterfaces.
   - Never change the state of the object: no calls that consume (`Iterator`, `Enumeration`, `InputStream`), move a position, or initialize something lazily (`Cipher.getProvider()` chooses a provider, see `utils/cryptoEngines.ts`). Read private fields instead where needed.
   - Don't subclass `GetterDecoder` or reference it at module level: it imports the resolver, which imports the class registry, which would import your decoder (an import cycle). Call `decodeGetterValues()` from a `RecursiveDecoder` instead.
   - Decode nested values by delegating to `JavaDecoderResolver.resolveDecoder(...)` or `ReferenceTypeDecoder`, passing `this.settings` along. Don't reimplement primitive or array handling.
   - Respect `settings.maxItems` (append `"[truncated at N]"`).
   - If the value contains other values (elements, entries, properties), extend `RecursiveDecoder` from `frooky/agent/src/shared/decoders/recursiveDecoder.ts` instead of `Decoder`. It enforces `settings.maxDepth`; implement `decodeRecursive(value, childSettings)` and decode the nested values with `childSettings`.
   - Handle `null` and falsy values (`0`, `false`) explicitly. Earlier regressions treated them as absent.
   - Return `long` values as decimal strings to avoid precision loss.
3. Register the decoder with its fully qualified class name. Inner classes use `$`, e.g. `android.content.ClipData$Item`.
4. Add `<SimpleName>Decoder.test.ts` next to the decoder. Build real objects with `Java.use(...).$new()` (tests run inside a live Android process) and assert on the exact `DecodedValue`. Cover empty, null, truncation and nested cases.

## Named custom decoders

Same implementation rules as above. After adding the entry to `CUSTOM_DECODER_REGISTRY`, **update the list of registered decoders in `docs/decoders-java.md` or `docs/decoders-native.md`** (the "Named Decoders" section). Hook files reference decoders by these names, and the JSON schema does not check them.

If the decoder needs context from another argument, it receives it via `decoderArg` (the `arg` parameter of `decode`).

## Native decoders

Type parsing lives in `nativeFridaType.ts`. Values are handled by `NativeValueDecoder` (fundamental types) or `NativeReferenceDecoder` (pointers), with `NativeFallbackDecoder` for anything else. Extend the parser or the reference decoder there, and add cases to the matching `*.test.ts`. For behavior visible in the target app, also add a function to `tests/target-apps/android/value-passing-native` and a test in `tests/integration/android/test_value_passing_native.py`.

## Finish

1. Build: `cd frooky/agent && npm run build:dev:android`.
2. Test on a device: `npm run test:android` (see the `device-testing` skill). If no device is available, say that the new tests were not run.
3. Update `docs/decoders-java.md` (the "Built-in Decoders" and "Limits" tables) or `docs/decoders-native.md` if user-visible output changed, and `docs/decoders.md` if a setting behaves differently. If the new decoder is worth showing, add it to `docs/examples/android/03_decoders/` (running against a target app) with a test in `tests/integration/android/test_examples.py`.
