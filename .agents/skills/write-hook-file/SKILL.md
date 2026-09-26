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

Reference docs: `docs/java-hook-declaration.md`, `docs/native-hook-declaration.md`, `docs/parameter-declaration.md`, `docs/return-type-declaration.md`, `docs/decoders.md`, `docs/additional-features.md`. Worked examples: `docs/examples/01_android.yaml` (Java) and `docs/examples/03_native.yaml` (native).

## Skeleton

```yaml
metadata:                       # optional
  name: Keystore key generation
  platform: Android
  description: Captures KeyGenParameterSpec used to create keys
  category: CRYPTO
  author: <author>
  version: 1

settings:                       # optional, applies to every group
  hookSettings: { stackTraceLimit: 5 }
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
          - ["const void *", buf, { decoderArg: num }]
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
- Non-terminated buffers need their length: `{ decoderArg: <name of the length param> }`.

**Parameter forms** (both platforms): `type` · `[type, name]` · `[type, name, {settings}]` · `{ type: ..., name: ..., <settings> }`. Hook forms: `- name` · `- [name, {decoderSettings}]` · the expanded object form.

**Decoder settings** (at file, group, hook or param level; lower levels override higher ones):
- `direction: in | out | inout`: use `out` or `inout` for buffers the callee fills (e.g. `Cipher.doFinal(byte[] output, ...)`, `RAND_bytes`).
- `decoder: <name>` (Java only), which must be one of the registered names: `string`, `hashCode`, `intentFlag`, `intentUriFlag`, `constant`. The schema does **not** check these names. If in doubt, check `CUSTOM_DECODER_REGISTRY` in `frooky/agent/src/android/decoders/javaDecoderResolver.ts`. Use `string` to show `byte[]` as text.
- `maxDepth` (default 10), `maxItems` (default 100), `fastDecode`, `hashCode` (instance correlation id), `paramFilter` (a regex list; only capture calls whose decoded value matches).

**Hook settings:** `stackTraceLimit` (default 0 = no stack trace) and `stackTraceFilter` (a regex list; an event is kept only if a captured frame matches). The filter works without a limit; the limit only controls how many frames end up in the event. Filters on app package prefixes (e.g. `"^org\\.owasp\\."`) are the usual way to drop framework noise.

## Validate

From the repo root (needs `npm ci` in `frooky/agent` once):

```bash
node .agents/skills/write-hook-file/validate.cjs hooks.yaml
```

This checks the file against `docs/schema/frooky-config.schema.json`. For `anyOf` mismatches, the deepest path in the error output usually points at the actual mistake. The validator catches structural errors, but not wrong class, method or decoder names; those only show up at runtime as `Resolved Hooks` counts and agent warnings (`frooky -vv`).

## Review checklist

- [ ] Every class/method or module/symbol has a `# Docs:` link and matches upstream exactly.
- [ ] Output buffers use `direction: out` or `inout`; native buffers without a terminator have a `decoderArg`.
- [ ] `decoder:` names come from the registered list.
- [ ] Hot methods (e.g. `String` methods, `HashMap.put`) are filtered or avoided; hooking them can make the app crawl.
- [ ] The file validates.
