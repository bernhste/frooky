---
name: write-hook-file
description: Use when writing, reviewing, or fixing a frooky hook file (YAML), e.g. "hook KeyStore usage", "trace calls to Cipher", "capture what the app sends to SharedPreferences", "hook SSL_write in libssl". Covers Java/Kotlin method hooks and native function hooks on Android, parameter/return declarations, decoders, filters, and validating the result.
---

# Writing a frooky hook file

## Workflow

1. **Find the real signatures.** Look up the exact class or module and the method or symbol signatures in upstream docs (developer.android.com, man pages, OpenSSL docs). Don't guess overloads or parameter types. A wrong overload matches nothing.
2. **Start minimal.** The short form (`- methodName`) hooks all overloads and resolves parameter types by reflection, so it is usually enough for Java. Only declare `overloads`/`params` when you need names, per-parameter settings, or a single overload.
3. **Add context.** Name parameters, pick decoders, set `direction` for output buffers, and add filters to cut noise.
4. **Validate** (see below), then run: `frooky -U -f <package> -e hooks.yaml`.

Reference docs: `docs/java-hook-declaration.md`, `docs/native-hook-declaration.md`, `docs/parameter-declaration.md`, `docs/return-type-declaration.md`, `docs/decoders.md`, `docs/decoders-java.md`, `docs/decoders-native.md`, `docs/additional-features.md`. Worked examples, one folder per topic: `docs/examples/android/` (Java) and `docs/examples/native/` (native), see `docs/examples/README.md`.

## Skeleton

```yaml
metadata:                       # optional
  name: Keystore key generation
  platform: Android
  description: Captures KeyGenParameterSpec used to create keys
  category: CRYPTO
  author: <author>
  version: 1

settings:                       # optional, applies to every hook collection
  hookSettings: { maxStackFrames: 5 }
  decoderSettings: { maxItems: 50 }

hookCollection:
  # Docs: <link to the upstream API>
  - javaClass: java.security.KeyPairGenerator
    hooks:
      - initialize

  - module: libssl.so
    hooks:
      - symbol: SSL_write
        retType: int
        params:
          - ["SSL *", ssl]
          - ["const void *", buf, { decoderArgs: { length: num } }]
          - [int, num]
```

## Rules that are easy to get wrong

**Java (`javaClass`)**

- Use fully qualified names. Inner classes use `$`: `android.security.keystore.KeyGenParameterSpec$Builder`.
- Constructors are `$init`.
- Java hooks have **no `retType`**; the return type comes from reflection.
- Type descriptors: primitives as-is (`int`, `boolean`); primitive arrays in JVM form (`"[B"` for `byte[]`, `"[I"`); object arrays as `"[Ljava.lang.String;"`; objects fully qualified (`java.lang.String`). Quote anything that starts with `[`.
- Overloads: each entry under `overloads` is one `params:` list matching one exact signature.

**Native (`module`)**

- `module` is the library file name (`libc.so`, `libssl.so`, `libcrypto.so`, or the app's own `lib<name>.so`).
- Declare `retType` and `params` with C types (`"const char *"`, `int`, `size_t`) if you want decoded values. Without them, only the call is recorded. Quote pointer types.
- Non-terminated buffers need their length in the role `length`: `{ decoderArgs: { length: <name of the length param> } }`. A Java method that uses a slice of an array (`byte[] b, int off, int len`) needs `{ decoderArgs: { offset: off, length: len } }`. Each decoder accepts only some roles, see `docs/decoders-native.md` and `docs/decoders-java.md`.

**Parameter forms** (both platforms): `type` · `[type, name]` · `[type, name, {settings}]` · `{ type: ..., name: ..., <settings> }`. Hook forms: `- name` · `- [name, {decoderSettings}]` · the expanded object form.

**Decoder settings.** `maxDepth`, `maxItems` and `decoder` can be set at the file, hook collection, hook and param/return type level; lower levels override higher ones. All other decoder settings can only be set on a single param or return type:

- `maxDepth` (default 10), `maxItems` (default 100).
- `decoder: <name>`, which must be one of the registered names. Java: `string`, `getters`, `hashCode`, `constants`, `bitmask`. Native: `string`, `utf16`, `errno` (return value only), `fd`, `constants`, `bitmask`, `nullTerminated`, and the presets `openFlags`, `mmapProt`, `mmapFlags`, `dlopenFlags`, `socketDomain`, `socketType`. `constants` and `bitmask` take their names from `config: { constants: { NAME: value } }`. In Java hooks, they read the `static final` fields of the hooked class instead, or of `config.class`, filtered by the pattern `config.fields` (`*` matches any characters), e.g. `config: { fields: "*_MODE" }` on `Cipher.init` or `config: { class: android.security.keystore.KeyProperties, fields: "PURPOSE_*" }`; prefer this over copying values from the docs, and narrow `fields` when a class has several constants with the same value. The names are the types `JavaDecoderName` and `NativeDecoderName` in `frooky/agent/src/shared/frookySettings.ts`. The schema checks them per platform in settings objects, but not inside a param tuple such as `["[B", data, { decoder: string }]`; frooky skips a hook with a decoder of the other platform at runtime. Use `string` to show `byte[]` as text.
- Param and return type only: `direction: in | out | inout` (params only; use `out` or `inout` for buffers the callee fills, e.g. `Cipher.doFinal(byte[] output, ...)`, `RAND_bytes`), `decoderArgs`, `config` (the options of the decoder, accepted only by the decoders that use them, e.g. `config: { constants: {...} }` for `constants` and `bitmask`), and `argFilter` (a regex list; only capture calls whose decoded value matches).

**Hook settings:** `nativeStackTrace`/`platformStackTrace` (off by default), `maxStackFrames` (default 5) and `callerFilter` (a regex list; a call is kept only if its caller matches). On Java hooks, `callerFilter` matches `<class>.<method>` anywhere on the Java stack except the hooked method itself, e.g. `"^org\\.owasp\\."` for the app's own code; it walks the Java stack on every call. On native hooks, it matches only the module name of the direct caller, e.g. `'^libapp\.so$'`, and is cheap; it never matches Java frames, and a libc function called from inside libc (e.g. `open` from `fopen`) has `libc.so` as its caller. It needs no stack trace.

## Validate

From the repo root (needs `npm ci` in `frooky/agent` once):

```bash
node .agents/skills/write-hook-file/validate.cjs hooks.yaml
```

This checks the file against `docs/schema/frooky-config.schema.json`. For `anyOf` mismatches, the deepest path in the error output usually points at the actual mistake. The validator catches structural errors, but not wrong class or method names, nor decoder names inside param tuples; those only show up at runtime as `(N waiting)` (class or module not loaded) or `(N not found)` (method or symbol not found) in the status bar, per-file `not found` counts, agent warnings, and debug logs (`frooky -vv`).

## Review checklist

- [ ] Every class/method or module/symbol has a `# Docs:` link and matches upstream exactly.
- [ ] Output buffers use `direction: out` or `inout`; native buffers without a terminator have the role `length` in `decoderArgs`, and Java slices have `offset` and `length`.
- [ ] `decoder:` names come from the registered list.
- [ ] Hot methods (e.g. `String` methods, `HashMap.put`) are filtered or avoided; hooking them can make the app crawl.
- [ ] No blocked function or method (e.g. `String.$init`, `Class.forName(String)`, `dlopen`): frooky skips them, see `docs/under-the-hood.md` (Danger Zone sections).
- [ ] The file validates.
