# Additional Settings and Best Practices

frooky supports two kinds of settings that can be used regardless of hook type:

<!-- TOC -->

- [Hook Settings](#hook-settings)
- [Decoder Settings](#decoder-settings)
- [Settings Precedence](#settings-precedence)
- [Event Filter Based on Stack Trace](#event-filter-based-on-stack-trace)
- [Stack Trace Limits](#stack-trace-limits)

<!-- /TOC -->

## Hook Settings

`hookSettings` controls how a hook itself behaves, independent of argument/return value decoding.

| Setting            | Type       | Default | Description                                                           |
| ------------------ | ---------- | ------- | --------------------------------------------------------------------- |
| `stackTraceLimit`  | `number`   | `0`     | Limits the number of stack frames captured per event.                 |
| `stackTraceFilter` | `string[]` | `[]`    | Regular expressions; only stack frames matching one of them are kept. |

## Decoder Settings

`decoderSettings` controls how a parameter's or return value's argument is decoded.

| Setting         | Type       | Default     | Description                                                                                                                                                          |
| --------------- | ---------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxRecursion`  | `number`   | `10`        | Maximum recursion depth when decoding nested structures (nested arrays, lists, maps, structs, etc.).                                                                 |
| `decodeLimit`   | `number`   | `1000`      | Maximum number of elements decoded from lists, arrays, collections, maps, etc.                                                                                       |
| `magicDecode`   | `boolean`  | `false`     | When enabled, frooky tries to guess the type of a value that isn't declared, or can't be deduced at runtime.                                                         |
| `fastDecode`    | `boolean`  | `false`     | When enabled, decoders prioritize speed over detail (mostly by avoiding expensive Frida <-> native round trips).                                                     |
| `customDecoder` | `string`   | `undefined` | Overrides the type decoder with a registered custom decoder. Java only, see [`customDecoder`](./parameter-declaration.md#customdecoder-option-override-the-decoder). |
| `decoderArg`    | `string`   | `undefined` | Name of another parameter passed to this parameter's decoder for additional context (e.g. a buffer's length).                                                        |
| `paramFilter`   | `string[]` | `undefined` | Regular expressions; the event for this hook is only captured if the decoded value matches one of them.                                                              |

`decoderSettings` can also be declared per-parameter, where they're combined with the `direction` option. See [Parameter Declaration](./parameter-declaration.md#decoders) and [Return Type Declaration](./return-type-declaration.md#decoders).

## Settings Precedence

Both `hookSettings` and `decoderSettings` can be declared at multiple levels of a hook file, from farthest to closest:

1. **Hard-coded defaults** (the tables above)
2. **File-level `settings`** — applies to every hook group in the file
3. **Hook group** (the `javaClass`/`module` block) — applies to every hook in that group
4. **Individual hook** (`method:`/`symbol:` block) — applies to that hook only
5. **Parameter** (`decoderSettings` only, since a parameter has no `hookSettings`) — applies to that parameter only

Each level only needs to set the fields it wants to override; anything it leaves out falls through to the next level out. The closest level always wins for the fields it sets.

**Example:**

```yaml
settings:
  hookSettings:
    stackTraceLimit: 5
  decoderSettings:
    maxRecursion: 1

hookCollection:
  - javaClass: org.owasp.mastestapp.MastgTest
    hookSettings:
      stackTraceLimit: 30
    decoderSettings:
      maxRecursion: 30
    hooks:
      - method: receiveIntArray
        hookSettings:
          stackTraceLimit: 40
        decoderSettings:
          maxRecursion: 40
        overloads:
          - params:
              - ["[I", arg, { maxRecursion: 50 }]
```

For the `arg` parameter, `maxRecursion` resolves to `50` (level 5 wins). `stackTraceLimit` for the `receiveIntArray` hook resolves to `40` (level 4 wins over the group's `30`), since `hookSettings` has no level closer than the hook itself.

See [`docs/examples/setting_tests_android/06_all_levels_combined.yaml`](./examples/setting_tests_android/06_all_levels_combined.yaml) and [`docs/examples/setting_tests_native/06_all_levels_combined.yaml`](./examples/setting_tests_native/06_all_levels_combined.yaml) for full worked examples.

## Event Filter Based on Stack Trace

If you hook a method that is used widely, you may capture many events you are not interested in. This makes the analysis more difficult.

To filter out events that do not originate from the target app, frooky can filter events based on the stack trace. The following declaration will capture only events where the target package name matches the stack trace:

```yaml
javaClass: android.app.SharedPreferencesImpl$EditorImpl
hookSettings:
  stackTraceFilter: ["^org\\.owasp\\.mastestapp"]
hooks:
  - putString
```

With this filter, noise can be reduced.

**Example: `SharedPreferences` used by Android**

Let's assume you want to know whether the target app uses them to store sensitive data on the device:

```yaml
javaClass: android.app.SharedPreferencesImpl$EditorImpl
hooks:
  - putString
```

frooky will capture the events you are looking for, as well as many more, such as the following one (see [Output Format](./output.md) for the full `hook-java` event schema):

```json
{
  "id": "169a35b1-da19-492f-a90c-74d7cc5bdb3a",
  "timestamp": "2026-02-09T09:08:32.125Z",
  "type": "hook-java",
  "stackTrace": [
    "android.app.SharedPreferencesImpl$EditorImpl.putString(Native Method)",
    "com.google.crypto.tink.integration.android.SharedPrefKeysetWriter.write(SharedPrefKeysetWriter.java:70)",
    "com.google.crypto.tink.KeysetHandle.writeWithAssociatedData(KeysetHandle.java:869)",
    "com.google.crypto.tink.KeysetHandle.write(KeysetHandle.java:858)",
    "com.google.crypto.tink.integration.android.AndroidKeysetManager$Builder.generateKeysetAndWriteToPrefs(AndroidKeysetManager.java:353)",
    "com.google.crypto.tink.integration.android.AndroidKeysetManager$Builder.build(AndroidKeysetManager.java:292)",
    "androidx.security.crypto.EncryptedSharedPreferences.create(EncryptedSharedPreferences.java:169)",
    "androidx.security.crypto.EncryptedSharedPreferences.create(EncryptedSharedPreferences.java:131)"
  ],
  "argsIn": [
    {
      "type": "java.lang.String",
      "value": "__androidx_security_crypto_encrypted_prefs_key_keyset__"
    },
[...]
  ],
  "javaClassName": "android.app.SharedPreferencesImpl$EditorImpl",
  "method": "putString",
  "fieldType": { "fieldType": "instance", "instanceId": 175301911 }
}
```

This method call is initiated by Android when `EncryptedSharedPreferences` are initiated. This library uses `SharedPreferences` to store an encryption key.

These events are usually not of interest to security testers, who want to test the target app rather than OS libraries.

## Stack Trace Limits

By default, frooky will show all function calls of a stack trace. If this is too much, you can set a limit using the `stackTraceLimit` hook setting.

```yaml
javaClass: android.app.SharedPreferencesImpl$EditorImpl
hookSettings:
  stackTraceLimit: 5
hooks:
  - putString
```

This is supported by Java and native hooks.
