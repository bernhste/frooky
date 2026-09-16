# Additional Settings and Best Practices

frooky supports two kinds of settings that can be used regardless of hook type: `hookSettings` (below) and `decoderSettings` (see [Decoders](./decoders.md)).

<!-- TOC -->

- [Hook Settings](#hook-settings)
- [Settings Precedence](#settings-precedence)
- [Event Filter Based on Stack Trace](#event-filter-based-on-stack-trace)

<!-- /TOC -->

## Hook Settings

`hookSettings` controls how a hook itself behaves, independent of argument/return value decoding.

| Setting            | Type       | Default | Description                                                           |
| ------------------ | ---------- | ------- | --------------------------------------------------------------------- |
| `stackTraceLimit`  | `number`   | `0`     | Limits the number of stack frames captured per event.                 |
| `stackTraceFilter` | `string[]` | `[]`    | Regular expressions; only stack frames matching one of them are kept. |

## Settings Precedence

Both `hookSettings` and [`decoderSettings`](./decoders.md#decoder-settings) can be declared at multiple levels of a hook file, from farthest to closest:

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
