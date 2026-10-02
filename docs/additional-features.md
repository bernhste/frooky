# Additional Settings and Best Practices

frooky supports two kinds of settings that can be used regardless of hook type: `hookSettings` (which configure stack traces and caller filters, see [Stack Traces](#stack-traces) and [Caller Filters](#caller-filters)) and `decoderSettings` (which configure parameter and return value decoding, see [Decoders](./decoders.md)).

<!-- TOC -->

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
- [Dangerous Low-Level, Early, and High-Frequency Hooks](#dangerous-low-level-early-and-high-frequency-hooks)
  - [Blocked Functions](#blocked-functions)
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
- Each hook applies its own filters. If one hook's `argFilter` or `callerFilter` doesn't match, the other hooks still record the call.
- Removing a hook, e.g. by deleting it from a hook file while frooky runs with `--watch`, stops only that hook's events. The method or function is restored once no hook is left on it.
- A declaration that is repeated identically in the same hook file is only hooked once.
- The events of all hooks on one call carry the same [`hashCode`](./output.md): of the Java instance, or of the native function's address.
- Two native symbols can be the same function, e.g. `memcpy` and `memmove` in some libcs. Hooking both records each call twice, and frooky warns: `libc.so!memmove is the same function as libc.so!memcpy`.

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

Capturing stack traces provides visibility into the execution path leading up to a hooked method or function. All stack trace and caller filter settings are declared under `hookSettings`.

### General Settings

`hookSettings` controls stack traces and which callers a hook records, independent of argument/return value decoding:

| Setting              | Type       | Default | Description                                                                                                                                                                                                                                                           |
| -------------------- | ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxStackFrames`     | `number`   | `5`     | Limits the number of frames captured per event, separately for the native and the platform stack trace. It doesn't limit the caller filters.                                                                                                                          |
| `nativeStackTrace`   | `boolean`  | `false` | Whether to capture native (C/C++) stack frames. Native hooks only: Java hooks have no native context and always capture an empty native stack trace.                                                                                                                  |
| `platformStackTrace` | `boolean`  | `false` | Whether to capture platform (managed runtime, e.g. Java on Android) stack frames. For a native hook, these are the Java frames that led to the native call, if it was called from Java.                                                                               |
| `callerFilter`       | `string[]` | `[]`    | Regular expressions; a call is only recorded if its caller matches one of them. Java hooks match the methods on the Java stack (e.g. `'^com\.myapp\.'`), native hooks the module of the direct caller (e.g. `'^libapp\.so$'`). See [Caller Filters](#caller-filters). |

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

| `skipped`      | Situation                                                                                                     | Why it's unsafe                                                                                                                                                                                   | Frames captured    |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `signal-stack` | The call runs in a signal handler on an alternate signal stack (`sigaltstack`), which is usually only 32KB.   | A stack walk and symbolizing can overflow it and crash the app.                                                                                                                                   | none               |
| `in-linker`    | The call happens inside `dlopen()`/`dlclose()` on this thread, e.g. in a library constructor or `JNI_OnLoad`. | The linker holds its lock and the module is only partly loaded. The stack walk needs that lock (`dl_iterate_phdr()`).                                                                             | none               |
| `linker-busy`  | Another thread is inside `dlopen()`/`dlclose()`, e.g. while the app starts.                                   | That thread can hold the linker's lock while it waits in a hook (e.g. on `mmap` or `openat`) until frooky's agent is free. A stack walk here would wait for the linker's lock, and the app hangs. | none               |
| `low-stack`    | Less than 64KB are left on the thread's stack. Native hooks only, as Java hooks have no CPU context to check. | A stack walk, symbolizing and the JavaScript engine's own frames can overflow the rest of the stack.                                                                                              | none               |
| `before-ready` | The app's own code hasn't started yet (spawn mode, before `Java.perform()`).                                  | Entering the Java VM for the Java frames this early can hang the app.                                                                                                                             | native frames only |

```json
"stackTrace": {
  "platformStackTrace": [],
  "nativeStackTrace": [],
  "skipped": "signal-stack"
}
```

A Java hook with a `callerFilter` drops these calls, as the filter can't be checked. This includes `before-ready`, when the app's own Java code hasn't run yet. A native hook's `callerFilter` needs no stack walk and is checked in every call.

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

## Caller Filters

Widely used methods and functions (such as `SharedPreferences`, crypto APIs, or libc's `fopen` and `strstr`) generate a lot of noise, because the framework, system libraries and third-party SDKs call them constantly. `callerFilter` records a call only if it comes from code you are interested in, usually the app's own packages or native libraries. It is a list of regular expressions under `hookSettings`, and what it matches depends on the hook:

| Hook        | Matches                            | Searches               | Cost per call                  |
| ----------- | ---------------------------------- | ---------------------- | ------------------------------ |
| Java hook   | Java methods as `<class>.<method>` | The whole Java stack   | A walk of the whole Java stack |
| Native hook | Module names, e.g. `libapp.so`     | The direct caller only | A few address comparisons      |

A call that doesn't match is dropped before its values are decoded and before any stack trace is built. `callerFilter` doesn't need `nativeStackTrace` or `platformStackTrace`; those only decide what the recorded event contains. An empty list means no filter.

A file-level `callerFilter` can mix both kinds of patterns, e.g. `['^com\.myapp\.', '^libapp\.so$']`: a package pattern never matches a module name, and a module pattern never matches a Java method.

### Java Hooks

For a Java hook, `callerFilter` searches the Java stack of the call for a matching method:

- Each Java frame is matched as `<class>.<method>`, e.g. `org.owasp.mastestapp.MastgTest.mastgTest`, without file and line. A pattern on a package prefix (`'^org\.owasp\.mastestapp\.'`) selects an app's or SDK's code; a pattern on a method selects single call sites.
- The whole Java stack is searched, not only the direct caller, and `maxStackFrames` doesn't limit it. A call the app makes through a library (e.g. the app → OkHttp → Conscrypt → `Cipher.init`) is recorded, because the app's method is further down the stack.
- The hooked method itself, on top of the stack, isn't searched.
- It walks the Java stack in every call, which costs as much as `platformStackTrace: true`. In the calls listed in [Skipped Stack Traces](#skipped-stack-traces) it can't be checked, and these calls are dropped.

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

- On arm64, `bl` stores the return address in the link register; on x86/x86_64, `call` pushes it onto the stack. frooky reads it when the function is entered, without a stack walk or symbol lookup.
- frooky keeps the address ranges of the modules whose name matches a pattern, and updates them when such a module is loaded or unloaded. A call is recorded if its return address is inside one of these ranges. Before a matching module is loaded, no call is recorded.
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

On a native hook, a call that `callerFilter` drops is never decoded, gets no stack walk, no check for [unsafe calls](#skipped-stack-traces) and no event. Where the filter runs depends on the other hooks of the function:

- **In native code**, if every hook of the function has a `callerFilter`, none records native stack traces and none decodes `float` or `double` values. A dropped call then never enters the JavaScript engine. This makes hooks on functions that run millions of times, such as `malloc` or `free`, affordable.
- **In JavaScript** otherwise. Every call still enters the JavaScript engine twice and waits for the lock all hooks share, which is fine for functions such as `open` or `strstr` but takes seconds of CPU time per second on `malloc`.

`frooky -vv` logs which of the two a function uses. See [Caller Filters in Under the Hood](./under-the-hood.md#caller-filters) for how it works.

### Pitfalls

- **Calls inside libc:** a native hook's `callerFilter` only sees the direct caller. When the app calls `fopen`, libc's `fopen` calls `open` itself, so the caller of that `open` is `libc.so`. Hook the function the app calls, here `fopen`. Adding `libc.so` to the filter records the calls of the whole process.
- **Fortified calls:** apps built with `_FORTIFY_SOURCE` call checked variants for some functions, e.g. `__open_2` for `open` without a mode, or `__memset_chk` for `memset`. A hook on `open` doesn't see these calls, with or without a filter. Hook the variants as well.
- **Inlined calls:** compilers replace small calls such as `memset(buf, 0, 16)` with a few instructions. These never reach libc and can't be hooked.
- **Tail calls:** if a function ends with `return memset(...)`, the compiler can jump to `memset` instead of calling it. The return address then belongs to the caller's caller.

See [`examples/android/05_hook_settings/02_caller_filter.yaml`](./examples/android/05_hook_settings/02_caller_filter.yaml) and [`examples/native/05_hook_settings/02_caller_filter.yaml`](./examples/native/05_hook_settings/02_caller_filter.yaml) for full examples.

## Dangerous Low-Level, Early, and High-Frequency Hooks

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
2. **Use `callerFilter`** to record only the calls of the app's own native libraries (e.g. `callerFilter: [libapp.so]`). The calls of every other module are dropped before decoding, see [Caller Filters](#performance).
3. **Use `argFilter`** to restrict capture to specific paths, descriptors, or buffers of interest (e.g. `argFilter: ['^/data/']`). `argFilter` is evaluated before any stack trace is captured, keeping non-matching calls fast and avoiding OS noise.
4. **Switch to V8 (`--runtime v8`)** if hooking many native functions or dealing with deep native call stacks, as V8's execution model requires significantly less native C-stack memory than QuickJS.

### Blocked Functions

A hook on some low-level functions breaks the app, whatever the hook file says. frooky skips these hooks, or their stack traces, with a warning:

| Function                                                 | Runtime | Blocked      | Why                                                                                                                                       |
| -------------------------------------------------------- | ------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pthread_getspecific`, `pthread_setspecific` (`libc.so`) | all     | hook         | Frida's Interceptor uses them itself: installing the hook hangs the app.                                                                  |
| `dlopen` (`libdl.so`)                                    | all     | hook         | The linker picks the namespace by the caller's address, which the hook changes, so system libraries (e.g. graphics drivers) fail to load. |
| `memset`, `clock_gettime` (`libc.so`)                    | V8      | hook         | V8 calls them itself while it runs a hook, which re-enters V8 and crashes the app (`SIGTRAP`). Use QuickJS to hook them.                  |
| `sigprocmask` (`libc.so`)                                | all     | stack traces | The native stack walk crashes the app in it. A `callerFilter` still works, as it needs no stack walk.                                     |

The list comes from hooking about 50 low-level libc and libdl functions on Android 15, with and without stack traces, under both runtimes. `android_dlopen_ext` and `dlsym` also depend on the caller's address but didn't break the test app, so they aren't blocked. Hooks declared with `offset` aren't checked.

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

While frooky is running in the terminal, pressing `i` or `I` prints one row per hook declaration: whether it is hooked, waiting for its class or module, or not resolved, how many overloads or functions it hooks, how many events these recorded so far, how many calls their `callerFilter` or `argFilter`s dropped, and how much time went into decoding the values of the recorded events. The decode time is summed from millisecond timestamps, so it is only accurate over many events. A hook with many filtered calls and few events still costs time on every call, see [Caller Filters](#caller-filters).

```text
Hook statistics
State         Hooks  Events  Filtered  Target                       File        Waits for
hooked            3      41         0  javax.crypto.Cipher.init     hooks.yaml
hooked            1   1,234    56,789  libc.so!open                 hooks.yaml
waiting           -       -         -  com.example.Plugin.run       hooks.yaml  Java class 'com.example.Plugin'
not resolved      -       -         -  libc.so!nope                 hooks.yaml
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
- Access violations are only reported if the faulting instruction is in a module with a native hook. ART raises and handles access violations itself all the time (e.g. implicit null checks), and the exception handler runs on the thread's small signal stack, so frooky decides by comparing addresses before it walks the stack. An access violation in code a hooked function calls, outside a hooked module, is not reported.
- Safe termination: frooky reports the crash reason and faulting context before allowing the OS process to terminate.

The crash reporter is disabled under V8 (`--runtime v8`): there, an installed exception handler makes hooks on functions such as libc's `strlen` crash the app. Frida still reports the crash signal, e.g. `process crashed (SIGTRAP SI_KERNEL)`, but without the backtrace and the hooked functions involved.
