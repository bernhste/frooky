# Additional Settings and Best Practices

frooky supports two kinds of settings that can be used regardless of hook type: `hookSettings` (below) and `decoderSettings` (see [Decoders](./decoders.md)).

<!-- TOC -->

- [Hook Settings](#hook-settings)
- [Settings Precedence](#settings-precedence)
- [Event Filter Based on Stack Trace](#event-filter-based-on-stack-trace)
- [Multiple Hooks on the Same Method or Function](#multiple-hooks-on-the-same-method-or-function)

<!-- /TOC -->

## Hook Settings

`hookSettings` controls how a hook itself behaves, independent of argument/return value decoding.

| Setting              | Type       | Default | Description                                                                                                                                                                                                                                                                       |
| -------------------- | ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxStackFrames`     | `number`   | `10`    | Limits the number of frames captured per event, separately for the native and the platform stack trace. With a `stackTraceFilter`, it also limits how deep the filter searches.                                                                                                   |
| `stackTraceFilter`   | `string[]` | `[]`    | Regular expressions; the event is only captured if at least one captured stack frame matches one of them. Only the enabled stack traces are searched, so without `nativeStackTrace` or `platformStackTrace` every event is dropped. A match keeps the whole captured stack trace. |
| `nativeStackTrace`   | `boolean`  | `false` | Whether to capture native (C/C++) stack frames. Native hooks only: Java hooks have no native context and always capture an empty native stack trace.                                                                                                                              |
| `platformStackTrace` | `boolean`  | `false` | Whether to capture platform (managed runtime, e.g. Java on Android) stack frames. For a native hook, these are the Java frames that led to the native call, if it was called from Java.                                                                                           |

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
    maxStackFrames: 5
  decoderSettings:
    maxRecursion: 1

hookCollection:
  - javaClass: org.owasp.mastestapp.MastgTest
    hookSettings:
      maxStackFrames: 30
    decoderSettings:
      maxRecursion: 30
    hooks:
      - method: receiveIntArray
        hookSettings:
          maxStackFrames: 40
        decoderSettings:
          maxRecursion: 40
        overloads:
          - params:
              - ["[I", arg, { maxRecursion: 50 }]
```

For the `arg` parameter, `maxRecursion` resolves to `50` (level 5 wins). `maxStackFrames` for the `receiveIntArray` hook resolves to `40` (level 4 wins over the group's `30`), since `hookSettings` has no level closer than the hook itself.

See [`docs/examples/setting_tests_android/06_all_levels_combined.yaml`](./examples/setting_tests_android/06_all_levels_combined.yaml) and [`docs/examples/setting_tests_native/06_all_levels_combined.yaml`](./examples/setting_tests_native/06_all_levels_combined.yaml) for full worked examples.

## Event Filter Based on Stack Trace

If you hook a method that is used widely, you may capture many events you are not interested in. This makes the analysis more difficult.

To filter out events that do not originate from the target app, frooky can filter events based on the stack trace. The following declaration will capture only events where the target package name matches the stack trace:

```yaml
javaClass: android.app.SharedPreferencesImpl$EditorImpl
hookSettings:
  platformStackTrace: true
  stackTraceFilter: ["^org\\.owasp\\.mastestapp"]
hooks:
  - putString
```

With this filter, noise can be reduced. The filter only searches the captured frames, so it needs `platformStackTrace` or `nativeStackTrace`; without either, every event is dropped.

Stack traces are off by default because capturing them is expensive, and a native stack walk can crash hooks on low-level functions such as libc's `open`: these may run on a small signal stack, or the stack walk itself calls the hooked function again. On a signal stack, frooky captures no frames at all.

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

## Multiple Hooks on the Same Method or Function

A Java method or native function can be hooked more than once, e.g. by two hook files that both hook `javax.crypto.Cipher.init`, or by two declarations in one file with different parameters, filters or settings. Every hook records its own event on each call, decoded with its own `params`, `retType`, `decoderSettings` and `hookSettings`. Java and native hooks behave the same:

- The hooked method or function still runs once per call. Only the number of events changes.
- Each hook applies its own filters. If one hook's `argFilter` or `stackTraceFilter` doesn't match, the other hooks still record the call.
- Removing a hook, e.g. by deleting it from a hook file while frooky runs with `--watch`, stops only that hook's events. The method or function is restored once no hook is left on it.
- A declaration that is repeated identically in the same hook file is only hooked once.

**Example:** record every `Cipher.init` call, and additionally decode `opmode` of the `init(int, Key)` overload with the `constant` decoder:

```yaml
hookCollection:
  - javaClass: javax.crypto.Cipher
    hooks:
      - init
      - method: init
        overloads:
          - params:
              - [int, opmode, { decoder: constant }]
              - [java.security.Key, key]
```

A call to `init(int, Key)` produces two events: one from the first hook with the raw `opmode` (e.g. `1`), and one from the second hook with the constant name (e.g. `"ENCRYPT_MODE"`). Calls to other `init` overloads produce one event.

See [`docs/examples/android/05_multiple_hooks.yaml`](./examples/android/05_multiple_hooks.yaml) and [`docs/examples/native/06_multiple_hooks.yaml`](./examples/native/06_multiple_hooks.yaml) for full examples.
