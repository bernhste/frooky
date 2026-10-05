# Additional Features

How to work with a running frooky, the settings that apply to every hook (stack traces, caller filters, early hooking), and the runtime options.

<!-- TOC -->

- [Interacting with frooky](#interacting-with-frooky)
  - [Watch Mode (`-w` / `--watch`)](#watch-mode--w----watch)
  - [Interactive Manual Reload (`r` / `R` Key)](#interactive-manual-reload-r--r-key)
  - [Hook Statistics (`s` / `S` Key)](#hook-statistics-s--s-key)
  - [Show or Hide Events (`e` / `E` Key)](#show-or-hide-events-e--e-key)
- [Settings Precedence](#settings-precedence)
- [Multiple Hooks on the Same Method or Function](#multiple-hooks-on-the-same-method-or-function)
- [Stack Traces](#stack-traces)
  - [General Settings](#general-settings)
  - [Skipped Stack Traces](#skipped-stack-traces)
  - [Platform vs. Native Stack Traces](#platform-vs-native-stack-traces)
- [Caller Filters](#caller-filters)
  - [Java Hooks](#java-hooks)
  - [Native Hooks](#native-hooks)
  - [Performance](#performance)
  - [Pitfalls](#pitfalls)
- [Early Hooking](#early-hooking)
  - [Spawn vs. Attach](#spawn-vs-attach)
  - [`early: true`](#early-true)
- [Dangerous Low-Level and High-Frequency Hooks](#dangerous-low-level-and-high-frequency-hooks)
  - [Blocked Functions](#blocked-functions)
- [Custom User Scripts](#custom-user-scripts)
- [JavaScript Runtime: QuickJS vs. V8](#javascript-runtime-quickjs-vs-v8)
- [Native Crash Reporter](#native-crash-reporter)

<!-- /TOC -->

## Interacting with frooky

When writing or testing hook definitions, restarting the app or re-running frooky repeatedly slows down analysis. While frooky runs, it can reload the hook files, either when they change (watch mode) or when you press a key. Other keys show the state of the hooks and turn printing the events on or off.

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
- **Retries hooks that were not found:** Any hooks whose method or symbol wasn't found (for instance, because it was misspelled) are retried immediately. Hooks that wait for their class or native library keep waiting.

### Hook Statistics (`s` / `S` Key)

While frooky is running in the terminal, pressing `s` or `S` prints one row per hooked method or function, and one per hook declaration that is waiting for its class or module or not found: its state, how many overloads it hooks (Java hooks only, `-` for native hooks), how many events these recorded so far, how many calls their `callerFilter` or `argFilter`s dropped, how much time went into decoding the values of the recorded events, and the target. Below a waiting target is what it waits for. The states are explained in [Hook Initialization](./under-the-hood.md#hook-initialization) in Under the Hood. The decode time is summed from millisecond timestamps, so it is only accurate over many events. A hook with many filtered calls and few events still costs time on every call, see [Caller Filters](#caller-filters).

A declaration with a [class](./java-hook-declaration.md#basic-usage), [method](./java-hook-declaration.md#method-wildcards), [symbol](./native-hook-declaration.md#symbol-wildcards) or [module](./native-hook-declaration.md#module-wildcards) wildcard gets one row per method or function it matched, with `via` and the pattern below the target; only the method or symbol pattern if the class or module is the same. A target too long for the terminal wraps, with its further lines indented. A function or overload that another declaration hooks too, in the same or another hook file, gets an `also hooked` line for each of them, e.g. `also hooked via SSL_*`, `also hooked in other.yaml` or `also hooked: 2 of 3 overloads via com.example.*.b*`. Each declaration records its own event per call, so these calls show up more than once in the output. `also hooked as libc.so!memmove` is the same function under another name, e.g. `memcpy` and `memmove` in some libcs.

```text
Hook statistics
                                         Decoding
                                             time
State      Overloads  Events  Filtered      (sum)  Target                                       File
hooked             3      41         0       3 ms  javax.crypto.Cipher.init                     hooks.yaml
hooked             -      12         0       0 ms  libc.so!inet_pton                            hooks.yaml
                                                     via inet_*
                                                     also hooked in other.yaml
hooked             -   1,234    56,789      2.3 s  libc.so!open                                 hooks.yaml
hooked             -       7         0       4 ms  libssl3.so!SSL_write                         hooks.yaml
                                                     via libssl*.so!SSL_write
hooked             2       5         0       1 ms  org.owasp.net.HttpClient.send                hooks.yaml
                                                     via org.owasp.*.HttpClient.send*
hooked             1       2         0       0 ms  org.owasp.net.HttpClient.sendAsync           hooks.yaml
                                                     via org.owasp.*.HttpClient.send*
waiting            -       -         -          -  com.example.Plugin.run                       hooks.yaml
                                                     waits for Java class 'com.example.Plugin'
not found          -       -         -          -  libc.so!nope                                 hooks.yaml
```

### Show or Hide Events (`e` / `E` Key)

While frooky is running in the terminal, pressing `e` or `E` turns printing the captured events to the terminal on or off, as `-e`/`--print-events` does at startup. Events are written to the output file either way.

## Settings Precedence

Every hook has two kinds of settings: `hookSettings` configure how events are captured, e.g. [stack traces](#stack-traces) and [caller filters](#caller-filters), and [`decoderSettings`](./decoders.md#decoder-settings) how parameters and return values are decoded. Both can be declared at multiple levels of a hook file, from farthest to closest:

1. **Defaults**: the hard-coded values in the tables below and in [Decoders](./decoders.md#decoder-settings)
2. **File**: the top-level `settings`, applies to every hook in the file
3. **Hook collection**: the `javaClass`/`module` entry in `hookCollection`, applies to every hook in it
4. **Hook**: the `method`/`symbol`/`offset` entry, applies to that hook only
5. **Parameter and return type**: `decoderSettings` only, applies to that one value

Each level only needs to set the fields it wants to override; anything it leaves out falls through to the next level out. The closest level always wins for the fields it sets.

Of the decoder settings, only `maxDepth`, `maxItems` and `decoder` are passed down through these levels. `direction`, `decoderArgs`, `config` and `argFilter` describe one value, so they are only set on a parameter or return type (see [Decoder Settings](./decoders.md#decoder-settings)).

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
- Each hook applies its own filters. If one hook's `argFilter` or `callerFilter` doesn't match, the other hooks still record the call.
- Removing a hook, e.g. by deleting it from a hook file while frooky runs with `--watch`, stops only that hook's events. The method or function is restored once no hook is left on it.
- A declaration that is repeated identically in the same hook file is only hooked once.
- The events of all hooks on one call carry the same [`hashCode`](./output.md): of the Java instance, or of the native function's address.
- Two native symbols can be the same function, e.g. `memcpy` and `memmove` in some libcs. Hooking both records each call twice, and frooky warns: `libc.so!memmove is the same function as libc.so!memcpy`.

**Example:** record every `Cipher.init` call, and additionally decode `opmode` of the `init(int, Key)` overload with the `constants` decoder:

```yaml
hookCollection:
  - javaClass: javax.crypto.Cipher
    hooks:
      - init
      - method: init
        overloads:
          - params:
              - [int, opmode, { decoder: constants }]
              - [java.security.Key, key]
```

A call to `init(int, Key)` produces two events: one from the first hook with the raw `opmode` (e.g. `1`), and one from the second hook with the constant name (e.g. `"ENCRYPT_MODE"`). Calls to other `init` overloads produce one event.

See [`examples/android/07_multiple_hooks/`](./examples/android/07_multiple_hooks/) and [`examples/native/07_multiple_hooks/`](./examples/native/07_multiple_hooks/) for full examples.

## Stack Traces

Capturing stack traces provides visibility into the execution path leading up to a hooked method or function. All stack trace and caller filter settings are declared under `hookSettings`.

### General Settings

`hookSettings` controls stack traces and which callers a hook records, independent of argument/return value decoding:

| Setting              | Type       | Default | Description                                                                                                                                                                                                                                                           |
| -------------------- | ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxStackFrames`     | `number`   | `5`     | Limits the number of frames captured per event, separately for the native and the platform stack trace. It doesn't limit the caller filters.                                                                                                                          |
| `nativeStackTrace`   | `boolean`  | `false` | Whether to capture native (C/C++) stack frames. Native hooks only: Java hooks have no native context and always capture an empty native stack trace.                                                                                                                  |
| `platformStackTrace` | `boolean`  | `false` | Whether to capture platform (managed runtime, e.g. Java on Android) stack frames. For a native hook, these are the Java frames that led to the native call, if it was called from Java.                                                                               |
| `callerFilter`       | `string[]` | `[]`    | Regular expressions; a call is only recorded if its caller matches one of them. Java hooks match the methods on the Java stack (e.g. `'^com\.myapp\.'`), native hooks the module of the direct caller (e.g. `'^libapp\.so$'`). See [Caller Filters](#caller-filters). |
| `early`              | `boolean`  | `false` | Whether native hooks skip the wait until the app's own code is about to run (`targetReady`), so they record calls during startup, e.g. from library constructors and `JNI_OnLoad`. Only matters when spawning (`-f`). See [Early Hooking](#early-hooking).            |

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

Some calls happen where walking the stack can crash or hang the app. frooky detects these per call and leaves out the frames it can't capture safely. If requested frames are missing, the `stackTrace` object has a `skipped` field with the reason:

| `skipped`      | When                                                                                                  | Frames captured                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `signal-stack` | The call runs in a signal handler, on its small alternate signal stack.                               | none                                                                  |
| `linker-busy`  | Another thread is loading or unloading a library (`dlopen()`/`dlclose()`), e.g. while the app starts. | approximate native frames; Java frames from shortly after start-up on |
| `low-stack`    | Less than 64KB are left on the thread's stack. Native hooks only.                                     | none                                                                  |
| `before-ready` | The app's own code hasn't started yet (spawn mode, before `targetReady`).                             | native hooks: native frames only; Java hooks: everything              |

At `linker-busy`, the `skipped` field is only set if the Java frames are missing. The native frames are approximate and can include addresses that aren't return addresses. Calls from a library's constructor, inside `dlopen()` on their own thread, get full stack traces. See [Stack Traces During Early Hooking](./under-the-hood.md#stack-traces-during-early-hooking) for how frooky detects these calls and why a stack walk in them is unsafe.

```json
"stackTrace": {
  "platformStackTrace": [],
  "nativeStackTrace": [],
  "skipped": "signal-stack"
}
```

A Java hook with a `callerFilter` drops a call whose Java stack can't be walked, as the filter can't be checked, e.g. at `linker-busy` right after start-up. Before `targetReady` (`before-ready`), the filter is checked as usual. A native hook's `callerFilter` needs no stack walk and is checked in every call.

### Platform vs. Native Stack Traces

frooky distinguishes between managed runtime frames and native C/C++ frames:

- **`platformStackTrace` (Managed Runtime / Java):**
  - Captures frames from the managed runtime (ART/Dalvik on Android), innermost (the hooked method) first.
  - Frame format: `<class>.<method> (<file>:<line>)`, for example:
    `org.owasp.mastestapp.MastgTest.receiveString (MastgTest.kt:-1)`
  - **Java hooks:** Captures the Java caller hierarchy that called the hooked method.
  - **Native hooks:** If the native function was invoked from Java via JNI, captures the Java frames that led to the native call. If the native function was called from a native thread without Java on its stack, `platformStackTrace` is `[]`.

- **`nativeStackTrace` (C / C++ Native Context):**
  - Captures the C/C++ return addresses of the call, resolved to their module and symbol.
  - Frame format: `<symbol>+<offset> (<module>:<address>)`, for example:
    `Java_org_owasp_mastestapp_MastgTest_receiveStringsJNI+0x42 (libreceiveString.so:0x763e4c3a33b4)`
  - **Native hooks:** Starts with the direct caller of the hooked function (the hooked function itself is at the hook point and not in the backtrace).
  - **Java hooks:** `nativeStackTrace` is always `[]`.

- **Independent Limits:**
  - `maxStackFrames` applies to `platformStackTrace` and `nativeStackTrace` independently. If both are enabled and `maxStackFrames: 2`, the event contains up to 2 platform frames and up to 2 native frames (4 frames total).

See [`examples/android/05_hook_settings/01_platform_stack_trace.yaml`](./examples/android/05_hook_settings/01_platform_stack_trace.yaml) and [`examples/native/05_hook_settings/01_native_and_platform_stack_traces.yaml`](./examples/native/05_hook_settings/01_native_and_platform_stack_traces.yaml) for complete examples.

## Caller Filters

Widely used methods and functions (such as `SharedPreferences`, crypto APIs, or libc's `fopen` and `strstr`) generate a lot of noise, because the framework, system libraries and third-party SDKs call them constantly. `callerFilter` records a call only if it comes from code you are interested in, usually the app's own packages or native libraries. It is a list of regular expressions under `hookSettings`. They aren't anchored: `libapp.so` also matches `mylibapp.so`, so write `'^libapp\.so$'` to match one module exactly. What they match depends on the hook:

| Hook        | Matches                            | Searches               | Cost per call                                  |
| ----------- | ---------------------------------- | ---------------------- | ---------------------------------------------- |
| Java hook   | Java methods as `<class>.<method>` | The whole Java stack   | A walk of the Java stack up to the first match |
| Native hook | Module names, e.g. `libapp.so`     | The direct caller only | A few address comparisons                      |

A call that doesn't match is dropped before its values are decoded and before any stack trace is built. `callerFilter` doesn't need `nativeStackTrace` or `platformStackTrace`; those only decide what the recorded event contains. An empty list means no filter.

A file-level `callerFilter` can mix both kinds of patterns, e.g. `['^com\.myapp\.', '^libapp\.so$']`: a package pattern never matches a module name, and a module pattern never matches a Java method.

### Java Hooks

For a Java hook, `callerFilter` searches the Java stack of the call for a matching method:

- Each Java frame is matched as `<class>.<method>`, e.g. `org.owasp.mastestapp.MastgTest.mastgTest`, without file and line. A pattern on a package prefix (`'^org\.owasp\.mastestapp\.'`) selects an app's or SDK's code; a pattern on a method selects single call sites.
- The whole Java stack is searched, not only the direct caller, and `maxStackFrames` doesn't limit it. A call the app makes through a library (e.g. the app → OkHttp → Conscrypt → `Cipher.init`) is recorded, because the app's method is further down the stack.
- The hooked method itself, on top of the stack, isn't searched.
- It walks the Java stack in every call, which costs as much as `platformStackTrace: true`. In the calls in which the Java frames are left out, see [Skipped Stack Traces](#skipped-stack-traces), it can't be checked, and these calls are dropped.

**Example:** record the `trackEvent` calls that go through an SDK:

```yaml
javaClass: org.owasp.mastestapp.MastgTest
hookSettings:
  callerFilter:
    - org.owasp.mastestapp.ThirdPartySdk
hooks:
  - trackEvent
```

The app calls `trackEvent` directly from `mastgTest` and through `ThirdPartySdk.flush`. Only the second call is recorded. `'org.owasp.mastestapp.MastgTest'` would record both, as `mastgTest` is on the stack of both.

The same applies to library code the app uses: `EncryptedSharedPreferences` (Google Tink) calls `SharedPreferences.Editor.putString` when it creates its keyset. With `callerFilter: [org.owasp.mastestapp]`, that call is recorded if the app called `EncryptedSharedPreferences.create`. A `putString` of a framework component on its own thread has no app method on its stack and is dropped.

### Native Hooks

For a native hook, `callerFilter` checks the module of the call's return address, i.e. the module that called the function directly:

- It needs no stack walk, so it's cheap and is also checked in the calls whose stack traces are [skipped](#skipped-stack-traces).
- Only the modules loaded at the time of the call count. Before a matching module is loaded, no call is recorded.
- The patterns are matched against module names (e.g. `libreceiveString.so`), not paths.
- Java frames aren't searched: a native function that Java code calls through JNI has `libart.so`, the JNI method's library or JIT-compiled code as its caller.

**Example:** record the files the app's own native library opens, and drop every `fopen` and `unlink` of ART, the framework and the system libraries:

```yaml
module: libc.so
hookSettings:
  callerFilter:
    - libreceiveString.so
hooks:
  - symbol: fopen
    retType: "void *"
    params:
      - ["const char *", pathname]
      - ["const char *", mode]
  - symbol: unlink
    retType: [int, { decoder: errno }]
    params:
      - ["const char *", pathname]
```

| Caller                               | Return address in                         | Recorded |
| ------------------------------------ | ----------------------------------------- | -------- |
| `read_status()` → `fopen`            | `libreceiveString.so`                     | yes      |
| `delete_cache()` → `unlink`          | `libreceiveString.so`                     | yes      |
| ART or a framework library → `fopen` | e.g. `libart.so`, `libandroid_runtime.so` | no       |

To record native calls that the app's Java code causes, hook the Java API instead (e.g. `FileInputStream` instead of `open`), or capture `platformStackTrace` and filter the events afterwards.

### Performance

The figures below are orders of magnitude on an arm64 device, not measurements:

| Per call                                           | Cost                                         |
| -------------------------------------------------- | -------------------------------------------- |
| An unhooked `memset` on a small buffer             | ~10 ns                                       |
| Entering a hook's JavaScript code                  | ~2-5 µs, and the threads wait for each other |
| `callerFilter` of a native hook                    | + well under 1 µs                            |
| A call that a native `callerFilter` drops in C     | ~0.2 µs in total, no JavaScript              |
| Decoding the values and sending the event          | + ~10-50 µs                                  |
| Native stack trace                                 | + ~35 µs per frame to symbolize              |
| Java stack trace, or `callerFilter` of a Java hook | + 100 µs to several ms                       |

On a native hook, a call that `callerFilter` drops is never decoded, gets no stack walk and no event. It is cheapest, without entering the JavaScript engine at all, if every hook of the function has a `callerFilter`, none records native stack traces and none decodes `float` or `double` values. This makes hooks on functions that run millions of times, such as `malloc` or `free`, affordable. Otherwise every call still costs a few µs, which is fine for functions such as `open` or `strstr` but takes seconds of CPU time per second on `malloc`.

`frooky -vv` logs which case applies to a function. See [Caller Filters in Under the Hood](./under-the-hood.md#caller-filters) for how it works.

### Pitfalls

- **Calls inside libc:** a native hook's `callerFilter` only sees the direct caller. When the app calls `fopen`, libc's `fopen` calls `open` itself, so the caller of that `open` is `libc.so`. Hook the function the app calls, here `fopen`. Adding `libc.so` to the filter records the calls of the whole process.
- **Fortified calls:** apps built with `_FORTIFY_SOURCE` call checked variants for some functions, e.g. `__open_2` for `open` without a mode, or `__memset_chk` for `memset`. A hook on `open` doesn't see these calls, with or without a filter. Hook the variants as well.
- **Inlined calls:** compilers replace small calls such as `memset(buf, 0, 16)` with a few instructions. These never reach libc and can't be hooked.
- **Tail calls:** if a function ends with `return memset(...)`, the compiler can jump to `memset` instead of calling it. The return address then belongs to the caller's caller.

See [`examples/android/05_hook_settings/02_caller_filter.yaml`](./examples/android/05_hook_settings/02_caller_filter.yaml) and [`examples/native/05_hook_settings/02_caller_filter.yaml`](./examples/native/05_hook_settings/02_caller_filter.yaml) for full examples.

## Early Hooking

Many checks that matter for a security analysis run while the app starts, before its first screen: anti-tampering, root and Frida detection in ELF constructors (`.init_array`) or `JNI_OnLoad`, integrity checks of the APK, or libraries that unpack code at startup. To record them, the hooks must be installed before this code runs.

### Spawn vs. Attach

- **Spawn (`-f`):** frooky starts the app suspended, installs the hooks, and resumes it. Only a spawned app's startup can be recorded.
- **Attach (`-n`, `-N`, `-p`):** frooky attaches to an app that already runs. Its startup code has already run and isn't recorded.

### `early: true`

By default, native hooks wait until the app's own code is about to run (`targetReady`), since hooks on functions like `read` or `close` can deadlock the runtime (ART) while it starts its own threads. A library the app loads during startup, before `targetReady`, then runs its constructors and `JNI_OnLoad` unhooked. Java hooks don't wait, and native hooks on a library loaded after `targetReady` are installed while the linker loads it, before its constructors run.

With `early: true` in `hookSettings`, native hooks don't wait: a hook on a library that is already loaded, e.g. `libc.so`, is installed before the app is resumed, and a hook on a library loaded later is installed while the linker loads it, so its constructors and `JNI_OnLoad` run hooked:

```yaml
hookCollection:
  - module: libloadTime.so
    hookSettings:
      early: true
    hooks:
      - symbol: load_time_constructor
```

`early` only matters when spawning (`-f`): when attaching, the app is already past `targetReady`.

When using `early: true`:

- **Give high-frequency libc functions a `callerFilter`** (e.g. `open`, `read`, `write`, `malloc`). Without one, early hooks intercept the runtime's and the linker's own threads, which can deadlock the app or make it stop responding (ANR). frooky warns about such a hook.
- **Expect fewer stack frames before `targetReady`.** A native hook's calls before `targetReady` get native frames only (`skipped: before-ready`), see [Skipped Stack Traces](#skipped-stack-traces).
- **Hook the loader with care.** Hooking `android_dlopen_ext` in `libdl.so` shows which libraries the app loads, but intercepting the dynamic linker can break loads across Android linker namespaces.

See [`01_spawn_vs_attach.yaml`](./examples/native/08_early_hooking/01_spawn_vs_attach.yaml), [`02_calls_while_loading.yaml`](./examples/native/08_early_hooking/02_calls_while_loading.yaml) and [`03_stack_traces_while_loading.yaml`](./examples/native/08_early_hooking/03_stack_traces_while_loading.yaml). [Timing](./under-the-hood.md#timing) in Under the Hood shows what can be hooked in each stage of the startup.

## Dangerous Low-Level and High-Frequency Hooks

Hooks on low-level libc functions that the app calls very often, such as `open`, `openat`, `close`, `read`, `write`, `mmap`, `mprotect`, `malloc`, `free`, `memcpy` or `memset`, can break or slow down the app, especially with stack traces:

- **Crashes:** these functions often run on threads with small stacks (512KB–1MB) or in signal handlers (32–64KB). The hook, a stack walk and, under QuickJS, the JavaScript engine itself use that stack and can overflow it (`SIGSEGV` / `SEGV_ACCERR`). frooky leaves out the stack traces of such calls (see [Skipped Stack Traces](#skipped-stack-traces)), but the hook still runs.
- **Hangs:** a Java stack trace (`platformStackTrace`) in a native hook enters the Java VM from inside the hooked call. If the caller holds a lock the VM waits for, the app hangs (ANR).
- **Slowdowns:** symbolizing native frames takes ~35µs per frame. On functions called thousands of times per second, the app stutters or stops responding.

**Recommendations for low-level and high-frequency hooks:**

1. **Keep `early: false` (the default)** unless you need to record code that runs during startup, and then give these functions a `callerFilter`, see [Early Hooking](#early-hooking).
2. **Keep stack traces disabled** on high-frequency libc functions (`nativeStackTrace: false`, `platformStackTrace: false`).
3. **Use `callerFilter`** to record only the calls of the app's own native libraries (e.g. `callerFilter: ['^libapp\.so$']`). The calls of every other module are dropped before decoding, see [Caller Filters](#performance).
4. **Use `argFilter`** to restrict capture to specific paths, descriptors, or buffers of interest (e.g. `argFilter: ['^/data/']`). `argFilter` is evaluated before any stack trace is captured, keeping non-matching calls fast and avoiding OS noise.
5. **Switch to V8 (`--runtime v8`)** if hooking many native functions or dealing with deep native call stacks, as V8's execution model requires significantly less native C-stack memory than QuickJS.

### Blocked Functions

A few functions and methods break the app however they are hooked. frooky doesn't install these hooks, or leaves out their stack traces, and logs a warning instead:

| Native function                                          | Runtime | Blocked      | Instead                      |
| -------------------------------------------------------- | ------- | ------------ | ---------------------------- |
| `pthread_getspecific`, `pthread_setspecific` (`libc.so`) | all     | hook         | –                            |
| `dlopen` (`libdl.so`)                                    | all     | hook         | –                            |
| `memset`, `clock_gettime` (`libc.so`)                    | V8      | hook         | QuickJS, the default runtime |
| `sigprocmask` (`libc.so`)                                | all     | stack traces | A `callerFilter` still works |
| `mmap` (`libc.so`), with `early: true`                   | V8      | stack traces | QuickJS, or `early: false`   |

A function is matched by its symbol and module, also if the hook names the module by path or without `.so`, e.g. `/apex/com.android.runtime/lib64/bionic/libc.so` or `libc`. A hook by `offset:` on one of these functions isn't detected.

| Java method                                                                                                                      | Overloads            | Instead                                                   |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| `java.lang.String.$init`                                                                                                         | all                  | The `newStringFrom*` methods of `java.lang.StringFactory` |
| `java.lang.Class.forName`                                                                                                        | `(java.lang.String)` | The overload with a `ClassLoader` parameter               |
| `java.lang.System.loadLibrary`                                                                                                   | all                  | –                                                         |
| `newUpdater` of `java.util.concurrent.atomic.AtomicIntegerFieldUpdater`, `AtomicLongFieldUpdater`, `AtomicReferenceFieldUpdater` | all                  | –                                                         |
| `dalvik.system.VMStack.getStackClass2`, `sun.reflect.Reflection.getCallerClass`                                                  | all                  | –                                                         |

A hook that declares `overloads` loses the blocked ones; a hook on every overload, e.g. `- forName`, skips them. Whether a hook breaks the app can also depend on whether it's installed before the app's first call, e.g. during start-up. On the Android 17 emulator, Frida 17.22.1 can't hook Java methods in a spawned app at all.

Why each one is blocked is explained in [Blocked Native Functions](./under-the-hood.md#danger-zone-blocked-native-functions) and [Blocked Java Methods](./under-the-hood.md#danger-zone-blocked-java-methods) in Under the Hood.

See [`03_low_level_functions.yaml`](./examples/native/05_hook_settings/03_low_level_functions.yaml).

## Custom User Scripts

frooky allows loading custom Frida JavaScript or TypeScript files into the target process before the frooky agent is initialized and installs its hooks:

```bash
frooky -U -f com.example.app -l unpin.js -l bypass_root.js hooks.yaml
```

The `-l` (or `--load`) option can be specified multiple times to execute several scripts in the order provided on the command line.

**Common use cases:**

- **SSL/TLS Certificate Unpinning:** Injecting standard universal Android SSL pinning bypass scripts before any network connections are initiated.
- **Root and Integrity Bypass:** Overriding common detection checks (e.g. `File.exists` checks for `/system/bin/su` or root beer detectors) before application logic runs.
- **Environment Setup:** Setting global variables, configuring instrumentation hooks, or monkey-patching libraries before the frooky agent installs its YAML-declared hooks.

User scripts can be written in JavaScript (`.js`) or TypeScript (`.ts`), which frooky compiles. Both can use the Java bridge (`Java`):

```typescript
// unlock.ts
import Java from "frida-java-bridge";

interface UnlockConfig {
  premium: boolean;
}

const config: UnlockConfig = { premium: true };

Java.perform(() => {
  const MainActivity = Java.use("com.example.app.MainActivity");
  MainActivity.isPremium.implementation = () => config.premium;
});
```

The bridge can be imported (`import Java from "frida-java-bridge";`), required (`require("frida-java-bridge")`) or used as a global (`Java.perform(...)`). A script that uses it runs in the frooky agent's script and shares the agent's bridge, so it works when frooky attaches and when it spawns the app (`-f`). Other scripts, e.g. ones that only use `Interceptor`, run as their own Frida script.

A script that uses the Java bridge:

- **Shares hooks with the hook files:** a Java method has one replacement at a time. If a script and a hook file hook the same method, the one installed later replaces the other, and frooky logs a warning naming the method. When frooky spawns the app, the script's `Java.perform()` callbacks run once the app is ready: a script's hook replaces frooky's hooks on framework classes, which frooky installs before, and frooky's hooks on the app's classes replace the script's.
- **Prints its output with its name:** `console.log()` and `send()` show up in the terminal tagged with the script's file name, e.g. `[unlock.ts]`.
- **Has no `rpc.exports`:** they would replace the agent's, so a script's `rpc.exports` are ignored.

See [User Scripts](./under-the-hood.md#user-scripts) in Under the Hood for how frooky loads them.

See [`examples/native/09_custom_scripts/`](./examples/native/09_custom_scripts/) for an example using custom scripts.

## JavaScript Runtime: QuickJS vs. V8

Frida supports two JavaScript runtimes: **QuickJS** and **Google V8**. By default, frooky runs under QuickJS (`--runtime qjs`). You can switch to V8 using `--runtime v8`:

```bash
frooky -U -f com.example.app --runtime v8 hooks.yaml
```

QuickJS starts faster and needs less memory. V8 uses less of the hooked thread's stack, so low-level hooks crash less often, at the cost of more memory and a slower start. See [JavaScript Runtimes](./under-the-hood.md#javascript-runtimes) in Under the Hood.

**When to switch to V8:**

- **Low-level native hooks:** When hooking frequently called libc functions (e.g. `open`, `read`, `write`, `malloc`) or native code with deep call stacks, QuickJS can exhaust the thread stack and cause a crash (`SIGSEGV` / `SEGV_ACCERR`).
- **Complex decoders and heavy throughput:** If decoding large collections, high-frequency events, or running demanding user scripts loaded via `-l`.

**Limitations of V8:**

- Hooks on libc's `memset` and `clock_gettime` are skipped, see [Blocked Functions](#blocked-functions).
- The [Native Crash Reporter](#native-crash-reporter) is disabled.

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
- Access violations are only reported if the faulting instruction is in a module with a native hook, as ART raises and handles them itself all the time (e.g. implicit null checks). An access violation in code a hooked function calls, outside a hooked module, is not reported.
- Safe termination: frooky reports the crash reason and faulting context before allowing the OS process to terminate.

The crash reporter is disabled under V8 (`--runtime v8`), see [Crash Reporter](./under-the-hood.md#crash-reporter) in Under the Hood for why. Frida still reports the crash signal, e.g. `process crashed (SIGTRAP SI_KERNEL)`, but without the backtrace and the hooked functions involved.
