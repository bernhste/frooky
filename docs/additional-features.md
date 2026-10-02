# Additional Settings and Best Practices

frooky supports two kinds of settings that can be used regardless of hook type: `hookSettings` (which configure stack traces and stack filtering, see [Stack Traces](#stack-traces)) and `decoderSettings` (which configure parameter and return value decoding, see [Decoders](./decoders.md)).

<!-- TOC -->

- [Settings Precedence](#settings-precedence)
- [Multiple Hooks on the Same Method or Function](#multiple-hooks-on-the-same-method-or-function)
- [Stack Traces](#stack-traces)
  - [General Settings](#general-settings)
  - [Skipped Stack Traces](#skipped-stack-traces)
  - [Platform vs. Native Stack Traces](#platform-vs-native-stack-traces)
  - [Stack Trace Filtering](#stack-trace-filtering)
  - [Dangerous Low-Level, Early, and High-Frequency Hooks](#dangerous-low-level-early-and-high-frequency-hooks)
- [Custom User Scripts](#custom-user-scripts)
- [Hot-Reloading and Watch Mode](#hot-reloading-and-watch-mode)
  - [Watch Mode (`-w` / `--watch`)](#watch-mode--w----watch)
  - [Interactive Manual Reload (`r` / `R` Key)](#interactive-manual-reload-r--r-key)
- [Dynamic Class and Module Resolution](#dynamic-class-and-module-resolution)
  - [Hook Statistics (`i` / `I` Key)](#hook-statistics-i--i-key)
- [JavaScript Runtime: QuickJS vs. V8](#javascript-runtime-quickjs-vs-v8)
- [Native Crash Reporter](#native-crash-reporter)

<!-- /TOC -->

## Settings Precedence

Both `hookSettings` and [`decoderSettings`](./decoders.md#decoder-settings) can be declared at multiple levels of a hook file, from farthest to closest:

1. **Defaults**: the hard-coded values in the tables below and in [Decoders](./decoders.md#decoder-settings)
2. **File**: the top-level `settings`, applies to every hook in the file
3. **Hook collection**: the `javaClass`/`module` entry in `hookCollection`, applies to every hook in it
4. **Hook**: the `method`/`symbol`/`offset` entry, applies to that hook only
5. **Parameter and return type**: `decoderSettings` only, applies to that one value

Each level only needs to set the fields it wants to override; anything it leaves out falls through to the next level out. The closest level always wins for the fields it sets.

**Example:**

```yaml
settings:
  hookSettings:
    platformStackTrace: true
    maxStackFrames: 1
  decoderSettings:
    maxItems: 10

hookCollection:
  - javaClass: org.owasp.mastestapp.MastgTest
    hookSettings:
      maxStackFrames: 2
    decoderSettings:
      maxItems: 15
    hooks:
      - method: receiveString
        hookSettings:
          maxStackFrames: 3
        decoderSettings:
          maxItems: 20
        overloads:
          - params:
              - [java.lang.String, arg, { maxItems: 25 }]
            retType: { maxItems: 30 }
```

For `receiveString`, the event has 3 platform stack frames: the hook's `maxStackFrames` wins, and `platformStackTrace: true` still comes from the file. The argument is decoded up to 25 characters (parameter level), the return value up to 30 (return type level).

The examples in [`examples/android/06_settings_precedence/`](./examples/android/06_settings_precedence/) and [`examples/native/06_settings_precedence/`](./examples/native/06_settings_precedence/) add one level per file and document the resulting event. They run against the target apps in `tests/target-apps/android` as part of the integration tests.

## Multiple Hooks on the Same Method or Function

A Java method or native function can be hooked more than once, e.g. by two hook files that both hook `javax.crypto.Cipher.init`, or by two declarations in one file with different parameters, filters or settings. Every hook records its own event on each call, decoded with its own `params`, `retType`, `decoderSettings` and `hookSettings`. Java and native hooks behave the same:

- The hooked method or function still runs once per call. Only the number of events changes.
- Each hook applies its own filters. If one hook's `argFilter` or `stackTraceFilter` doesn't match, the other hooks still record the call.
- Removing a hook, e.g. by deleting it from a hook file while frooky runs with `--watch`, stops only that hook's events. The method or function is restored once no hook is left on it.
- A declaration that is repeated identically in the same hook file is only hooked once.
- The events of all hooks on one call carry the same [`hashCode`](./output.md): of the Java instance, or of the native function's address.

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

See [`examples/android/07_multiple_hooks/`](./examples/android/07_multiple_hooks/) and [`examples/native/07_multiple_hooks/`](./examples/native/07_multiple_hooks/) for full examples.

## Stack Traces

Capturing stack traces provides visibility into the execution path leading up to a hooked method or function. All stack trace capture and filtering settings are declared under `hookSettings`.

### General Settings

`hookSettings` controls how a hook captures and filters stack traces, independent of argument/return value decoding:

| Setting              | Type       | Default | Description                                                                                                                                                                                                                                                                       |
| -------------------- | ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxStackFrames`     | `number`   | `5`     | Limits the number of frames captured per event, separately for the native and the platform stack trace. With a `stackTraceFilter`, it also limits how deep the filter searches.                                                                                                   |
| `nativeStackTrace`   | `boolean`  | `false` | Whether to capture native (C/C++) stack frames. Native hooks only: Java hooks have no native context and always capture an empty native stack trace.                                                                                                                              |
| `platformStackTrace` | `boolean`  | `false` | Whether to capture platform (managed runtime, e.g. Java on Android) stack frames. For a native hook, these are the Java frames that led to the native call, if it was called from Java.                                                                                           |
| `stackTraceFilter`   | `string[]` | `[]`    | Regular expressions; the event is only captured if at least one captured stack frame matches one of them. Only the enabled stack traces are searched, so without `nativeStackTrace` or `platformStackTrace` every event is dropped. A match keeps the whole captured stack trace. |

In the output events, captured stack traces appear in the `stackTrace` object with separate arrays for `platformStackTrace` and `nativeStackTrace` (see [Output Format](./output.md)):

```json
"stackTrace": {
  "platformStackTrace": [
    "org.owasp.mastestapp.MastgTest.receiveString (MastgTest.kt:-1)",
    "org.owasp.mastestapp.MastgTest.mastgTest (MastgTest.kt:98)"
  ],
  "nativeStackTrace": []
}
```

Stack traces are disabled by default (`nativeStackTrace: false`, `platformStackTrace: false`) because capturing them introduces runtime overhead and unwinding can cause instability on low-level functions.

### Skipped Stack Traces

Some calls happen where walking the stack can crash or hang the app. frooky detects these per call and captures no stack trace for them. The `stackTrace` object then has a `skipped` field with the reason:

| `skipped`      | Situation                                                                                     | Frames captured    |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------ |
| `signal-stack` | The call runs in a signal handler on an alternate signal stack, which is usually only 32KB.   | none               |
| `in-linker`    | The call happens inside `dlopen()`/`dlclose()` on this thread, e.g. in a library constructor. | none               |
| `low-stack`    | Less than 64KB are left on the thread's stack. Native hooks only.                             | none               |
| `before-ready` | The app's own code hasn't started yet (spawn mode, before `Java.perform()`).                  | native frames only |

```json
"stackTrace": {
  "platformStackTrace": [],
  "nativeStackTrace": [],
  "skipped": "signal-stack"
}
```

A hook with a `stackTraceFilter` drops these calls, as the filter can't be checked. With `before-ready`, the filter is checked against the native frames.

### Platform vs. Native Stack Traces

frooky distinguishes between managed runtime frames and native C/C++ frames:

- **`platformStackTrace` (Managed Runtime / Java):**
  - Captures frames from the managed runtime (ART/Dalvik on Android), innermost (the hooked method) first.
  - Frame format: `<class>.<method> (<file>:<line>)`, for example:
    `org.owasp.mastestapp.MastgTest.receiveString (MastgTest.kt:-1)`
  - **Java hooks:** Captures the Java caller hierarchy that called the hooked method.
  - **Native hooks:** If the native function was invoked from Java via JNI, captures the Java frames that led to the native call. If the native function was called from a native thread without Java on its stack, `platformStackTrace` is `[]`.

- **`nativeStackTrace` (C / C++ Native Context):**
  - Captures C/C++ return addresses from the CPU context (`CpuContext`), resolving each address to its module and symbol.
  - Frame format: `<symbol>+<offset> (<module>:<address>)`, for example:
    `Java_org_owasp_mastestapp_MastgTest_receiveStringsJNI+0x42 (libreceiveString.so:0x763e4c3a33b4)`
  - **Native hooks:** Starts with the direct caller of the hooked function (the hooked function itself is at the hook point and not in the backtrace).
  - **Java hooks:** Java hooks execute within the managed runtime without an explicit native CPU context, so `nativeStackTrace` is always `[]`.

- **Independent Limits:**
  - `maxStackFrames` applies to `platformStackTrace` and `nativeStackTrace` independently. If both are enabled and `maxStackFrames: 2`, the event contains up to 2 platform frames and up to 2 native frames (4 frames total).

See [`examples/android/05_hook_settings/01_platform_stack_trace.yaml`](./examples/android/05_hook_settings/01_platform_stack_trace.yaml) and [`examples/native/05_hook_settings/01_native_and_platform_stack_traces.yaml`](./examples/native/05_hook_settings/01_native_and_platform_stack_traces.yaml) for complete examples.

### Stack Trace Filtering

Widely used methods (such as `android.util.Log`, `SharedPreferences`, or crypto APIs) generate significant event noise because framework services, background tasks, and third-party SDKs call them constantly.

To isolate calls originating from the target app, frooky can filter events using regular expressions on stack frames via `stackTraceFilter`.

**How stack trace filtering works:**

- Each pattern is a regular expression tested against individual frame strings (e.g. `'^org\.owasp\.mastestapp'`).
- Both `platformStackTrace` and `nativeStackTrace` frames are searched.
- The filter only searches the captured frames up to `maxStackFrames`. For example, with `maxStackFrames: 1`, only the direct caller (or the hooked method itself on Java) is tested.
- **Requires an enabled stack trace:** The filter inspects captured frames. If neither `platformStackTrace` nor `nativeStackTrace` is enabled, or if `maxStackFrames: 0`, every event is dropped.
- **Whole-event retention:** If at least one frame matches any pattern in `stackTraceFilter`, the entire event is preserved along with all its captured frames and arguments. If no frames match, the event is discarded.

**Example: Filtering `SharedPreferences` to App Code**

The Android framework and its libraries use `SharedPreferences` internally. For example, `EncryptedSharedPreferences` (using Google Tink) calls `putString` when initializing keysets:

```yaml
javaClass: android.app.SharedPreferencesImpl$EditorImpl
hookSettings:
  platformStackTrace: true
  stackTraceFilter: ["^org\\.owasp\\.mastestapp"]
hooks:
  - putString
```

Without `stackTraceFilter`, frooky captures internal OS and library events such as:

```json
{
  "id": "169a35b1-da19-492f-a90c-74d7cc5bdb3a",
  "timestamp": "2026-02-09T09:08:32.125Z",
  "type": "hook-java",
  "javaClassName": "android.app.SharedPreferencesImpl$EditorImpl",
  "method": "putString",
  "fieldType": { "fieldType": "instance" },
  "stackTrace": {
    "platformStackTrace": [
      "android.app.SharedPreferencesImpl$EditorImpl.putString (Native Method)",
      "com.google.crypto.tink.integration.android.SharedPrefKeysetWriter.write (SharedPrefKeysetWriter.java:70)",
      "com.google.crypto.tink.KeysetHandle.writeWithAssociatedData (KeysetHandle.java:869)",
      "com.google.crypto.tink.KeysetHandle.write (KeysetHandle.java:858)",
      "com.google.crypto.tink.integration.android.AndroidKeysetManager$Builder.generateKeysetAndWriteToPrefs (AndroidKeysetManager.java:353)",
      "com.google.crypto.tink.integration.android.AndroidKeysetManager$Builder.build (AndroidKeysetManager.java:292)",
      "androidx.security.crypto.EncryptedSharedPreferences.create (EncryptedSharedPreferences.java:169)",
      "androidx.security.crypto.EncryptedSharedPreferences.create (EncryptedSharedPreferences.java:131)"
    ],
    "nativeStackTrace": []
  },
  "argsIn": [
    {
      "type": "java.lang.String",
      "name": "key",
      "value": "__androidx_security_crypto_encrypted_prefs_key_keyset__"
    }
  ]
}
```

Because none of the stack frames match `^org\.owasp\.mastestapp`, this event is filtered out. Only calls originating from classes within `org.owasp.mastestapp` are recorded.

See [`examples/android/05_hook_settings/02_stack_trace_filter.yaml`](./examples/android/05_hook_settings/02_stack_trace_filter.yaml) and [`examples/native/05_hook_settings/02_stack_trace_filter.yaml`](./examples/native/05_hook_settings/02_stack_trace_filter.yaml) for full examples.

### Dangerous Low-Level, Early, and High-Frequency Hooks

Capturing stack traces and hooking low-level primitives carries stability and recursion risks, especially on high-frequency libc functions such as `open`, `openat`, `close`, `read`, `write`, `mmap`, `mprotect`, `malloc`, `free`, `memcpy`, or `memset`:

- **Recursion loops:** A native stack walk or JNI call can call the hooked function again. For example, resolving symbols during a stack walk reads `/proc/self/maps` using libc's `open` and `read`. If `open` or `read` is hooked with stack traces enabled, the hook recurses indefinitely and crashes the process.
- **Thread and signal stack exhaustion:** Low-level functions often run on Android background threads with small default stack sizes (typically 512 KB–1 MB) or on signal stacks (32 KB–64 KB); because QuickJS executes entirely on the calling thread's native C-stack, recursive callbacks and deep hook chains can quickly exhaust the remaining stack and trigger a stack overflow (`SIGSEGV` / `SEGV_ACCERR`). frooky detects alternate signal stacks (`sigaltstack`) and skips backtracing on them, but the hook itself still runs there.
- **Hangs:** A platform stack trace enters the Java VM from inside the hooked call. If the caller holds a lock the VM then waits for, the app hangs; `platformStackTrace` on libc's `write` does this during startup (ANR).
- **Performance degradation:** Resolving symbols for native frames takes ~35 µs per frame. On functions invoked thousands of times per second, capturing stack traces causes noticeable application stutter or ANR timeouts.

**Early Hooking (Spawn vs. Attach):**

Functions called during application launch (such as `Application.onCreate`, `JNI_OnLoad`, or early native library loads via `android_dlopen_ext` in `libdl.so`) only show up when frooky spawns the process with `-f`:

- **Spawn (`-f`):** frooky starts the app suspended, installs the hooks, and resumes execution. Startup calls and initial library loads are captured.
- **Attach (`-n`, `-N`, `-p`):** Attaches to an already running app. Code executed during startup has already finished and is not captured.
- **Loader hooks:** Hooking `android_dlopen_ext` in `libdl.so` can observe library loads, but intercepting the dynamic linker can break loads across Android linker namespaces.
- **Late-loaded code:** frooky hooks a native library as soon as it loads, before its constructors and `JNI_OnLoad` run, and a Java class as soon as a class loader has it, so calls made while they load are captured. This also works for code the app loads long after it starts. See [Dynamic Class and Module Resolution](#dynamic-class-and-module-resolution).

**Recommendations for low-level and high-frequency hooks:**

1. **Keep stack traces disabled** on high-frequency libc functions (`nativeStackTrace: false`, `platformStackTrace: false`).
2. **Use `argFilter`** to restrict capture to specific paths, descriptors, or buffers of interest (e.g. `argFilter: ['^/data/']`). `argFilter` is evaluated before any stack trace is captured, keeping non-matching calls fast and avoiding OS noise.
3. **Switch to V8 (`--runtime v8`)** if hooking many native functions or dealing with deep native call stacks, as V8's execution model requires significantly less native C-stack memory than QuickJS.

See [`examples/native/05_hook_settings/03_low_level_functions.yaml`](./examples/native/05_hook_settings/03_low_level_functions.yaml), [`examples/native/08_early_hooking/01_spawn_vs_attach.yaml`](./examples/native/08_early_hooking/01_spawn_vs_attach.yaml) and [`examples/native/08_early_hooking/02_calls_while_loading.yaml`](./examples/native/08_early_hooking/02_calls_while_loading.yaml) for full examples.

## Custom User Scripts

frooky allows loading custom Frida JavaScript files into the target process before the frooky agent is injected and initialized:

```bash
frooky -U -f com.example.app -l unpin.js -l bypass_root.js hooks.yaml
```

The `-l` (or `--load`) option can be specified multiple times to execute several scripts in the order provided on the command line.

**Common use cases:**

- **SSL/TLS Certificate Unpinning:** Injecting standard universal Android SSL pinning bypass scripts before any network connections are initiated.
- **Root and Integrity Bypass:** Overriding common detection checks (e.g. `File.exists` checks for `/system/bin/su` or root beer detectors) before application logic runs.
- **Environment Setup:** Setting global variables, configuring instrumentation hooks, or monkey-patching libraries before the frooky agent installs its YAML-declared hooks.

See [`examples/native/09_custom_scripts/`](./examples/native/09_custom_scripts/) for an example using custom scripts.

## Hot-Reloading and Watch Mode

When writing or testing hook definitions, restarting the app or re-running frooky repeatedly slows down analysis. frooky provides two mechanisms to reload hooks dynamically:

### Watch Mode (`-w` / `--watch`)

Run frooky with `-w` (or `--watch`) to have it monitor hook YAML files on disk:

```bash
frooky -U -f com.example.app -w hooks.yaml
```

Whenever a hook file is modified and saved, frooky computes an incremental diff between the currently installed hooks and the updated configuration:

- **Unchanged hooks** continue running without interruption.
- **Removed hooks** are detached cleanly from the target process.
- **New or modified hooks** are parsed, validated, and installed immediately.

If a syntax error or schema violation is introduced in the hook file, frooky displays the validation error in the terminal while keeping all previously valid hooks active.

### Interactive Manual Reload (`r` / `R` Key)

While frooky is running in the terminal, pressing `r` or `R` triggers an immediate reload:

- Re-reads and applies the current hook YAML files.
- **Retries unresolved hooks:** Any hooks that previously failed to resolve (for instance, because a method or symbol was misspelled) are retried immediately. Hooks that wait for their class or native library keep waiting.

## Dynamic Class and Module Resolution

Applications frequently load code dynamically:

- **Java/Kotlin:** Plugins or feature modules loaded at runtime via `DexClassLoader` or `PathClassLoader`, and the WebView implementation.
- **Native:** Shared libraries loaded on demand via `dlopen` or `System.loadLibrary`.

frooky waits for a class or native module that isn't loaded yet for as long as it runs, and hooks it when it loads. It doesn't check for it periodically, but is notified when the app loads code:

- **Native modules** are hooked while the linker loads them, before their constructors and `JNI_OnLoad` run. See [`02_calls_while_loading.yaml`](./examples/native/08_early_hooking/02_calls_while_loading.yaml).
- **Java classes** are hooked while the class loader that has them is created, before any of its code runs. See [Class Loaders](./java-hook-declaration.md#class-loaders), also for custom class loaders.

Classes and modules that haven't loaded `-t` seconds (`--resolver-timeout`, default: `5`) after the app starts are reported as waiting, in a warning and in the status bar, e.g. `# Hooks 38 (1 waiting)`. A misspelled class or module name shows up there too. Their hooks are still installed when they load:

```bash
frooky -U -f com.example.app -t 30 hooks.yaml
```

### Hook Statistics (`i` / `I` Key)

While frooky is running in the terminal, pressing `i` or `I` prints one row per hook declaration: whether it is hooked, waiting for its class or module, or not resolved, how many overloads or functions it hooks, and how many events these recorded so far.

```text
Hook statistics
State         Hooks  Events  Target                       File        Waits for
hooked            3      41  javax.crypto.Cipher.init     hooks.yaml
hooked            1   1,234  libc.so!open                 hooks.yaml
waiting           -       -  com.example.Plugin.run       hooks.yaml  Java class 'com.example.Plugin'
not resolved      -       -  libc.so!nope                 hooks.yaml
```

## JavaScript Runtime: QuickJS vs. V8

Frida supports two JavaScript runtimes: **QuickJS** and **Google V8**. By default, frooky runs under QuickJS (`--runtime qjs`). You can switch to V8 using `--runtime v8`:

```bash
frooky -U -f com.example.app --runtime v8 hooks.yaml
```

| Runtime                 | Pros                                                                                                                                | Considerations                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **QuickJS** (default)   | Extremely fast agent startup, minimal memory footprint (~2 MB).                                                                     | Executes JavaScript directly on the calling thread's native C-stack. Constrained on small Android background thread stacks (512 KB–1 MB) or signal stacks. |
| **V8** (`--runtime v8`) | JIT-compiled performance for high-throughput hooks; uses dedicated heap memory with significantly lower native C-stack consumption. | Larger memory overhead (~30–40 MB) and slightly longer initial injection startup time.                                                                     |

**When to switch to V8:**

- **Low-level native hooks:** When hooking frequently called libc functions (e.g. `open`, `read`, `write`, `malloc`) or native code with deep call stacks, QuickJS can exhaust the thread stack and cause a crash (`SIGSEGV` / `SEGV_ACCERR`). V8 avoids C-stack exhaustion because its execution model uses far less calling-thread C-stack space.
- **Complex decoders and heavy throughput:** If decoding large collections, high-frequency events, or running demanding user scripts loaded via `-l`.

## Native Crash Reporter

When hooking native functions or memory buffers, invalid pointers or hook side-effects can cause the target process to crash. frooky includes a built-in native exception handler that intercepts fatal signals:

- `SIGSEGV` / Access violation
- `SIGBUS` / Bus error
- `SIGABRT` / Abort
- `SIGILL` / Illegal instruction
- `SIGFPE` / Arithmetic exception

**Fault Attribution:**

When a crash occurs, frooky captures the native thread backtrace and matches the faulting instruction pointer and caller addresses against all installed native hooks:

- If the crash occurred inside or directly following an installed hook, frooky highlights the matching hook symbol, module, and offset in the terminal and logs.
- Access violations are only reported if the faulting instruction is in a module with a native hook. ART raises and handles access violations itself all the time (e.g. implicit null checks), and the exception handler runs on the thread's small signal stack, so frooky decides by comparing addresses before it walks the stack. An access violation in code a hooked function calls, outside a hooked module, is not reported.
- Safe termination: frooky reports the crash reason and faulting context before allowing the OS process to terminate.
