# Under the Hood

This page explains how frooky works internally: what happens to a hook from the hook file to the installed hook, when each kind of hook is installed, how a `callerFilter` decides which calls are recorded, and how events reach the host. It is optional reading for when you want to know why something behaves the way it does, e.g. why a hook shows up as `waiting`, why a call during startup was missed, or why a filtered hook still slows the app down. To learn how to use frooky, start with the [README](../README.md) and [Additional Features](./additional-features.md).

> [!NOTE]
> For now, this page describes the Android agent. iOS support is not yet complete, see the [README](../README.md).

<!-- TOC -->

- [Overview](#overview)
- [Life of a Hook](#life-of-a-hook)
  - [Validation](#validation)
  - [Hook Initialization](#hook-initialization)
  - [Resolve the Module or Class](#resolve-the-module-or-class)
  - [Resolve the Symbol, Offset or Method](#resolve-the-symbol-offset-or-method)
  - [Resolve Declared or Runtime Decoders](#resolve-declared-or-runtime-decoders)
  - [Install the Hook](#install-the-hook)
- [Installing Java Hooks](#installing-java-hooks)
- [Installing Native Hooks](#installing-native-hooks)
- [Blocked Native Functions](#blocked-native-functions)
- [Keeping Hooks Current](#keeping-hooks-current)
- [Early Hooking](#early-hooking)
  - [Stack Traces Before `targetReady`](#stack-traces-before-targetready)
- [Caller Filters](#caller-filters)
  - [The Path of a Native Call](#the-path-of-a-native-call)
  - [Which Listener a Function Gets](#which-listener-a-function-gets)
  - [Keeping the Module Ranges Current](#keeping-the-module-ranges-current)
  - [Caller Filters on Java Hooks](#caller-filters-on-java-hooks)
- [Capture an Event](#capture-an-event)
- [Collecting Events and Sending Them to the Host](#collecting-events-and-sending-them-to-the-host)

<!-- /TOC -->

## Overview

frooky has two parts:

- The **host** (Python) runs on your machine. It parses the command line, connects to the device, reads your hook files, writes `output.json` and shows the status bar.
- The **agent** (TypeScript) is injected into the app by Frida. It validates the hook files, finds the classes, methods and functions they declare, installs the hooks and decodes the values.

The diagram shows the simplified flow for a spawn. The **resolver** stands for everything that finds what a hook declaration names: the class or module, the method, symbol or offset in it, and the decoders for its values (steps 5 to 7), see [Life of a Hook](#life-of-a-hook). When attaching, the resume (step 11) is skipped and `targetReady` resolves right away.

```mermaid
sequenceDiagram
    autonumber
    participant Host
    box rgba(128, 128, 128, 0.15) frooky agent
        participant FA as index.js
        participant R as Resolver
        participant HM as Hook manager
    end
    participant App

    Host->>App: spawn suspended (-f) or attach (-p, -n, -N)
    Host->>FA: inject and initialize the agent
    Host->>FA: send the hook files
    FA->>FA: validate, normalize and diff<br/>the hook declarations
    FA->>R: resolve the declarations
    R->>R: find the module or class, the method,<br/>symbol or offset, and the decoders
    R-->>FA: resolved hooks
    FA->>HM: install the hooks that need no event<br/>(Java framework classes, early: true)
    HM->>App: hook the methods and functions
    FA-->>Host: loadFrookyConfigs() returns
    Host->>App: resume (spawn only)
    App-->>FA: targetReady
    FA->>R: look up what is still resolving
    R->>HM: install the hooks found now and the<br/>native hooks that waited for targetReady
    Note over R: classes and modules not loaded yet: waiting
    App-->>R: later: loads a library or creates a class loader
    R->>HM: install the hooks that waited for it
    FA-->>Host: progress reports
```

The host starts the agent and hands it the hook files over Frida's RPC. Everything after that, from validating the hook files to installing the hooks, happens inside the app's process. The agent sends three kinds of messages back: batches of events, progress reports for the status bar, and crash reports (see [Collecting Events and Sending Them to the Host](#collecting-events-and-sending-them-to-the-host)).

**`targetReady`** is the moment the app's own classes can be looked up, because the Android runtime has the app's class loader. It is a promise in `FrookyAgent`, resolved by a `Java.perform()` callback. When spawning, `Java.perform()` queues its callback until the app process binds its application: frida-java-bridge hooks `ActivityThread.handleBindApplication()` and runs the callback on the app's main thread, before the app's `Application` class is created. When attaching, the application already exists and `targetReady` resolves right away. Native hooks without `early: true`, the lookups in the app's class loaders and stack traces all wait for it.

**Source:** [`frooky/runner/runner.py`](../frooky/runner/runner.py) (attach or spawn, RPC calls, resume), [`frooky/agent/src/android/index.frooky.ts`](../frooky/agent/src/android/index.frooky.ts) (RPC exports, `targetReady`), [`frooky/agent/src/FrookyAgent.ts`](../frooky/agent/src/FrookyAgent.ts)

## Life of a Hook

The host passes all hook files at once to `loadFrookyConfigs` (step 3 of the [overview](#overview)). The RPC call returns once the hook files are parsed and every hook that needs no event, i.e. neither `targetReady` nor a class or module that loads later, is resolved and installed. In spawn mode, the host resumes the app right after (step 11), so these hooks are in place before any of the app's code runs. The other hooks keep resolving after the call has returned.

A **hook file** is one YAML file, which the host sends to the agent as a config, identified by its path. After normalization, each method (Java) or symbol or offset (native) in it is one **hook declaration**: diffs, [states](#hook-initialization) and the hook statistics count declarations. A declaration installs one **hook** per Java overload or native function. The **hook managers** resolve and install them: `AndroidHookManager` for Java hooks and `NativeHookManager` for native hooks.

Each hook file is processed on its own, all of them concurrently. Its hook declarations are validated and normalized, compared with the previously loaded version of the file (see [Keeping Hooks Current](#keeping-hooks-current)), and the new, changed and retried ones are resolved and installed.

**Source:** [`frooky/agent/src/FrookyAgent.ts`](../frooky/agent/src/FrookyAgent.ts)

### Validation

The hook-file format is described twice in TypeScript, once for the user and once for the code that processes it:

- **Input types** (the public interface, `Input*` in `frooky/agent/src/shared/inputParsing/`) describe what a hook file may contain. They are loose on purpose: most things can be written in several forms, e.g. a hook as just a method or symbol name or as an object, and settings can be left out. `npm run build:zodSchema` generates the Zod schemas in `zodSchemas/` from them, and `npm run build:jsonSchema` turns those into [`docs/schema/frooky-config.schema.json`](./schema/frooky-config.schema.json), which editors use to check and autocomplete hook files.
- **Normalized types** (`JavaHookDeclaration` and `NativeHookDeclaration` in `frooky/agent/src/shared/hook/hookDeclaration.ts`, with `Param` and `RetType`) are what the rest of the agent works with. They are not part of the schemas. Each normalized hook declaration is self-contained and always has the same shape: it carries its class or module, its fully merged `hookSettings` and `decoderSettings`, and each parameter and return value carries its own merged decoder settings. The hook managers, decoders and the diff in [Keeping Hooks Current](#keeping-hooks-current) never need to look at the collection or the file's settings, and never handle shorthands.

Normalization turns one into the other. For example, a parameter (`InputParam`) can be written in five forms:

```yaml
- module: libcrypto.so
  decoderSettings:
    maxItems: 32
  hooks:
    - symbol: EVP_EncryptInit_ex
      params:
        - "EVP_CIPHER_CTX *"                               # type only
        - ["const EVP_CIPHER *", cipher]                   # type + name
        - ["ENGINE *", { maxDepth: 2 }]                    # type + settings
        - ["const unsigned char *", key, { maxItems: 16 }] # type + name + settings
        - { type: "const unsigned char *", name: iv }      # object
```

After normalization, every parameter is a `Param` object with its `type`, its `name` if it has one, its `direction` and its complete decoder `settings`: the defaults, overridden by the file's settings, the collection's, the hook's and finally the parameter's own. The hook itself has inherited its `module` and has its complete settings:

```yaml
module: libcrypto.so
symbol: EVP_EncryptInit_ex
params:
  - { type: "EVP_CIPHER_CTX *", direction: in, settings: { maxDepth: 10, maxItems: 32 } }
  - { type: "const EVP_CIPHER *", name: cipher, direction: in, settings: { maxDepth: 10, maxItems: 32 } }
  - { type: "ENGINE *", direction: in, settings: { maxDepth: 2, maxItems: 32 } }
  - { type: "const unsigned char *", name: key, direction: in, settings: { maxDepth: 10, maxItems: 16 } }
  - { type: "const unsigned char *", name: iv, direction: in, settings: { maxDepth: 10, maxItems: 32 } }
hookSettings: { maxStackFrames: 5, nativeStackTrace: false, platformStackTrace: false, callerFilter: [], early: false }
decoderSettings: { maxDepth: 10, maxItems: 32 }
```

Only the input is validated, against the Zod schemas generated from the input types. The normalized form is produced by frooky itself, and TypeScript guarantees its shape:

- `validateAndRepairFrookyConfig()` checks the file's `metadata` and `settings`. Invalid metadata and unknown properties only cause a warning. An invalid setting is reset to its default, also with a warning, and an invalid regular expression in `callerFilter` is dropped. The settings of a hook collection are repaired the same way. A file without a `hookCollection` is skipped; the other files still load.
- Each hook declaration is checked against its input schema (`inputJavaHookSchema` or `inputNativeHookSchema`) before it is normalized. An invalid declaration, including an invalid setting on the hook or one of its values, is dropped with a warning that names the invalid field; the other declarations of the file still load. A property the schema doesn't know, e.g. a misspelled `retTyp`, is ignored with a warning.

**Source:** [`frooky/agent/src/shared/configValidator.ts`](../frooky/agent/src/shared/configValidator.ts), [`frooky/agent/src/shared/inputParsing/`](../frooky/agent/src/shared/inputParsing/), [`frooky/agent/src/shared/hook/hookDeclaration.ts`](../frooky/agent/src/shared/hook/hookDeclaration.ts)

### Hook Initialization

```mermaid
flowchart LR
    subgraph resolving
        rm["resolve the<br/>module or class"]
        qm{"found?"}
        rs["resolve the method,<br/>symbol or offset"]
        qs{"found?"}
        ih["resolve the decoders,<br/>install the hooks"]
    end
    start(( )) -->|normalized<br/>hook declaration| rm
    rm --> qm
    qm -->|yes| rs
    qm -->|no| wait(["waiting"])
    wait -->|module or<br/>class loads| rs
    rs --> qs
    qs -->|yes| ih
    qs -->|no| nf(["not found"])
    ih --> installed(["installed"])
```

Each normalized hook declaration is initialized on its own: frooky resolves its module or class, then the method, symbol or offset in it, then the decoders for its values, and then installs its hooks: Frida's Interceptor for a native function, a replaced implementation for a Java method.

A hook declaration is in one of these states, shown in the status bar and the [hook statistics](./additional-features.md#hook-statistics-i--i-key):

| State       | Meaning                                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolving` | frooky is resolving its module or class, its method, symbol or offset, or the decoders for its values.                                                                       |
| `waiting`   | Its module or class isn't loaded yet. frooky hooks the linkers and class loaders for these modules and classes. If they are loaded later, frooky will try to hook them then. |
| `installed` | The hook is installed and ready to be called.                                                                                                                                |
| `not found` | Its module or class is there, but the method, symbol or offset isn't. frooky doesn't look for it again.                                                                      |

**Source:** [`frooky/agent/src/FrookyAgent.ts`](../frooky/agent/src/FrookyAgent.ts)

**Source:** [`frooky/agent/src/android/hook/androidHookValidator.ts`](../frooky/agent/src/android/hook/androidHookValidator.ts), [`frooky/agent/src/native/hook/nativeHookValidator.ts`](../frooky/agent/src/native/hook/nativeHookValidator.ts)

### Resolve the Module or Class

```mermaid
flowchart LR
    decl(( )) -->|class or module| loaded{"loaded?"}
    loaded -->|yes| found(["found"])
    loaded -->|no| watch["watch class loaders<br/>or the linker"]
    watch -->|found by<br/>targetReady| found
    watch -->|not found by<br/>targetReady| wait(["waiting"])
    wait -->|the app loads it| found
```

The Java and native declarations go to their hook managers concurrently. Each hook manager groups the declarations by their class or module and looks each one up once, no matter how many hooks target it. frooky doesn't poll for classes and modules, and doesn't wait a fixed time for them: a class or module that isn't loaded yet is found when the app loads it.

A **Java class**, e.g. `javax.crypto.Cipher` or `org.owasp.mastestapp.MainActivity`, is looked up by `JavaClassResolver.find()`:

1. In the default class loader with `Java.use()`. It has the Android framework's classes, also before the app runs, so a framework class is found right away.
2. Otherwise at `targetReady`, in every class loader the app has by then (`Java.enumerateClassLoadersSync()`), e.g. the `PathClassLoader` with the app's own classes.
3. Otherwise the declaration is `waiting`. Since step 1 missed, frooky watches the constructors of `BaseDexClassLoader` and its subclasses, which every class loader that reads dex files runs, and looks the class up in each new class loader while it is created, before any of its classes are used. This also catches class loaders created before `targetReady`.

A **native module**, e.g. `libc.so` or `libnative-lib.so`, is looked up by `NativeHookManager`:

1. In the loaded modules with `Process.findModuleByName()`. The system libraries, e.g. `libc.so`, are found right away.
2. Otherwise frooky attaches a module observer (`Process.attachModuleObserver()`, once) and waits for a module with this name or path. Its `onAdded` callback runs on the thread that loads the module, inside the linker, before the module's constructors and `JNI_OnLoad` run.
3. At `targetReady`, frooky doesn't look again, it only checks whether the observer has seen the module. If not, the declaration is `waiting` until it loads.

As soon as the class or module is found, frooky resolves the [method, symbol or offset](#resolve-the-symbol-offset-or-method) in it, in the same callback: for a class loader or module that loads later, on the app's thread, before the app runs its code.

**Source:** [`frooky/agent/src/android/hook/javaClassResolver.ts`](../frooky/agent/src/android/hook/javaClassResolver.ts), [`frooky/agent/src/native/hook/nativeHookManager.ts`](../frooky/agent/src/native/hook/nativeHookManager.ts) (`resolveHooks()`, `whenModuleLoaded()`)

### Resolve the Symbol, Offset or Method

```mermaid
flowchart LR
    found(["class or<br/>module found"]) --> java["Java: the method by name,<br/>then all its overloads"]
    found --> native["native: the symbol in the<br/>exports, or base + offset"]
    java -->|exists| hooks(["one hook per<br/>overload or function"])
    native -->|exists| hooks
    java -->|missing| nf(["not found"])
    native -->|missing| nf
```

The method, symbol or offset is resolved as soon as its class or module is found. That's also true for a native hook that is then only installed at `targetReady`, so a misspelled name fails right away.

A **Java method** is resolved by `resolveMethodHooks()`:

1. It looks up the method by name on the class (`javaClass[method]`). frida-java-bridge returns a method dispatcher with all overloads of that name.
2. Without `overloads`, every overload is hooked, each as its own hook. Its parameters are built from the overload's argument types, e.g. `[B`, `int` or `java.lang.String`, each with the declaration's `decoderSettings`. The return type comes from the overload as well. So a Java hook needs no `params` or `retType` in the hook file.
3. With `overloads`, only the declared ones are hooked (`method.overload(...types)`), with the parameters of the hook file. A declared overload that doesn't exist is skipped with a warning.

A **native function** is resolved by `resolveHook()`:

1. A `symbol` is looked up by `resolveSymbol()` in the module's exported (dynamic) symbols: with `findExportByName()` in a loaded module, and from the module's ELF exports (`enumerateExports()`, read once per module) in a module that is loading, as `getExportByName()` makes the linker abort the process while it loads the module.
2. An `offset` is resolved by `resolveModuleOffset()` as `module.base + offset`. frooky only hooks the address if it is inside the module and executable, and, if Frida finds a section at that address, if the section's name starts with `.text`, `.plt`, `.init` or `.fini`. Otherwise it skips the hook with a warning, e.g. for an offset from another build of the library, which can point into data: the Interceptor would overwrite that data and crash the app.

A method, symbol or offset that doesn't resolve, or a declaration whose `overloads` all don't exist, is logged as a warning, and the declaration is `not found`.

**Source:** [`frooky/agent/src/android/hook/androidHookManager.ts`](../frooky/agent/src/android/hook/androidHookManager.ts) (`resolveMethodHooks()`, `resolveOverloads()`), [`frooky/agent/src/native/hook/nativeHookManager.ts`](../frooky/agent/src/native/hook/nativeHookManager.ts) (`resolveHook()`, `resolveSymbol()`, `resolveModuleOffset()`)

### Resolve Declared or Runtime Decoders

```mermaid
flowchart LR
    value(["parameter or<br/>return value"]) --> type{"declared<br/>type"}
    type -->|"e.g. int, String,<br/>char *, int *"| declared["declared decoder,<br/>fixed per hook"]
    type -->|"Java object, e.g.<br/>java.lang.Object"| ref["ReferenceTypeDecoder"]
    ref -->|"per value:<br/>runtime class"| runtime["runtime decoder: class,<br/>interface or toString()"]
```

Decoders are resolved when a hook is installed (`prepareHook()`, called by `registerHooks()`), once per hook and not per call: one decoder for each parameter and one for the return value. `JavaDecoderResolver` and `NativeDecoderResolver` pick each one from the value's declared type and its merged decoder settings.

By default, without `decoder:`, the declared type decides. A **declared decoder** is fixed from then on. A **runtime decoder** is picked for each value while the hook runs, by the class of the object the app actually passes.

A **Java value** gets a declared decoder by its declared type, i.e. the type of the overload's parameter or return value:

| Declared type                             | Decoder                | Output                                                                                            |
| ----------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| A primitive, `void` or `java.lang.String` | `PrimitiveDecoder`     | The JSON value; a `long` is a decimal string to keep its 64-bit precision                         |
| An array, e.g. `[B` (`byte[]`)            | `ArrayDecoder`         | The elements, up to `maxItems`                                                                    |
| Any other class, e.g. `java.lang.Object`  | `ReferenceTypeDecoder` | Decoded by the runtime decoder of the object's class, see below                                   |
| An interface, e.g. `java.util.Map`        | `ReferenceTypeDecoder` | Decoded by the runtime decoder of the object's class, e.g. `MapDecoder` for a `java.util.HashMap` |

`ReferenceTypeDecoder` picks the decoder based on the runtime class when it decodes a value that isn't `null`, e.g. `java.util.HashMap` for a parameter declared as `java.util.Map`. The choice is cached by the class name (`$className`). On a cache miss, it gets the class with `getClass()` and takes the first of:

1. The class decoder of the runtime class or of its nearest superclass with one, e.g. `IntentDecoder` for `android.content.Intent`, or `X509CertificateDecoder` and not `CertificateDecoder` for an X.509 certificate.
2. The decoder of the most specific interface the class implements, e.g. `MapDecoder` for `java.util.HashMap`. If it implements several unrelated interfaces with a decoder, the order of the registry decides and frooky logs a warning.
3. `toString()`, with `StringDecoder`.

A **native value** only has its declared decoder: a native value is just a number or an address, with no runtime type to look at. Its declared type is the `type` in the hook file, which `parseNativeFridaType()` maps to a Frida type: it drops `const` and `volatile`, reads an array (`char *[]`) as a pointer, and knows the C and JNI names of the fundamental types, e.g. `uint8_t`, `long long` or `jint`.

| Declared type                                                   | Decoder                  | Output                                                                                             |
| --------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| A fundamental type, e.g. `int`, `size_t` or `jint`              | `NativeValueDecoder`     | The value; a 64-bit value is a decimal string                                                      |
| A pointer to a fundamental type, e.g. `char *` or `int *`       | `NativeReferenceDecoder` | The value it points to: a string for `char *`, the number for `int *`, the address for `void *`    |
| A pointer to UTF-16 units, e.g. `const jchar *` or `char16_t *` | `NativeUtf16Decoder`     | The string                                                                                         |
| Anything else, e.g. `FILE *`, `struct stat *` or `pid_t`        | `NativeFallbackDecoder`  | The raw value in hex, e.g. `0x7b2c4a1f00`: the address for a pointer, the value itself for `pid_t` |

`NativeDecoderResolver` checks for UTF-16 first: `jchar` is also a fundamental type (`uint16`), so `const jchar *` would otherwise be read as a pointer to one number.

**Source:** [`frooky/agent/src/shared/hook/hookManager.ts`](../frooky/agent/src/shared/hook/hookManager.ts) (`resolveParamDecoders()`), [`frooky/agent/src/android/decoders/javaDecoderResolver.ts`](../frooky/agent/src/android/decoders/javaDecoderResolver.ts), [`frooky/agent/src/android/decoders/builtin/ReferenceTypeDecoder.ts`](../frooky/agent/src/android/decoders/builtin/ReferenceTypeDecoder.ts), [`frooky/agent/src/native/decoders/nativeDecoderResolver.ts`](../frooky/agent/src/native/decoders/nativeDecoderResolver.ts)

### Install the Hook

When spawning, the host waits with the resume until these hooks are installed: Java hooks on classes of the default class loader (e.g. the Android framework's) and native hooks with `early: true` on modules that are already loaded. Native hooks without `early: true` on modules that are already loaded are resolved by then, but only installed at `targetReady`. Everything else waits for `targetReady` or for its class or module.

When a hook is installed decides which calls it can record: a call made before the hook is installed is missed. For an app that is spawned, the timing depends on the kind of hook, on whether its class or module is already loaded, and for native hooks on `early`. When attaching, `targetReady` has already resolved, so every hook is installed as soon as its class or module is found.

| Hook                                                                 | Installed (spawn)                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Java, class in the default class loader (e.g. `javax.crypto.Cipher`) | Before the app is resumed                                           |
| Java, class of the app or of a class loader created later            | At `targetReady`, or while the class loader that has it is created  |
| Native, module already loaded (e.g. `libc.so`)                       | At `targetReady`                                                    |
| Native, `early: true`, module already loaded                         | Before the app is resumed                                           |
| Native, module loaded before `targetReady`                           | At `targetReady`, after the module's constructors and `JNI_OnLoad`  |
| Native, `early: true`, module loaded before `targetReady`            | While the linker loads it, before its constructors and `JNI_OnLoad` |
| Native, module loaded after `targetReady`                            | While the linker loads it, before its constructors and `JNI_OnLoad` |

**Source:** [`frooky/agent/src/android/hook/androidHookManager.ts`](../frooky/agent/src/android/hook/androidHookManager.ts), [`frooky/agent/src/native/hook/nativeHookManager.ts`](../frooky/agent/src/native/hook/nativeHookManager.ts)

## Installing Java Hooks

Java hooks don't wait for `targetReady`: a class that the default class loader has is hooked right away (steps 3 and 4). A class that isn't found there is looked for in every class loader of the app at `targetReady`, and in every new `BaseDexClassLoader` (Path-, Dex-, InMemoryDex- and DelegateLastClassLoader) while it is created, before any of its code runs. See [Class Loaders](./java-hook-declaration.md#class-loaders).

```mermaid
sequenceDiagram
    autonumber
    participant FA as FrookyAgent
    participant PM as AndroidHookManager
    participant JCR as JavaClassResolver
    participant CL as App's class loaders

    FA->>PM: resolveHooks(Java declarations)
    PM->>JCR: find(javaClass, classLoader), once per class

    alt class name in the default class loader (e.g. javax.crypto.Cipher)
        JCR->>JCR: Java.use(javaClass) finds the class
        JCR-->>PM: onFound(classes, installNow = false)
        PM->>PM: resolveMethodHooks(): methods and overloads
    else not found yet, a wildcard pattern, or a classLoader
        JCR->>CL: watch the constructors of BaseDexClassLoader<br/>and its subclasses (once)
        Note over JCR: waits for targetReady
        FA-)JCR: targetReady resolves (spawn: on the app's main thread)
        JCR->>CL: look up the class in every existing class loader<br/>(wildcard: match the class names of their dex files)<br/>(classLoader: also watch its loadClass())
        CL->>JCR: later: a new class loader is created,<br/>or a watched loadClass() runs
        JCR->>JCR: look up the class or match the wildcards in it
        JCR-->>PM: onFound(classes, installNow = true)
        PM->>PM: resolveMethodHooks() and registerHooks() now,<br/>on the app's thread, before the class's code runs
    end

    PM-->>FA: hooks
    FA->>PM: registerHooks(): replace the method implementations<br/>(already installed ones are only counted)
```

**Source:** [`frooky/agent/src/android/hook/androidHookManager.ts`](../frooky/agent/src/android/hook/androidHookManager.ts), [`frooky/agent/src/android/hook/javaClassResolver.ts`](../frooky/agent/src/android/hook/javaClassResolver.ts)

## Installing Native Hooks

By default, a native hook waits for `targetReady`, even if its module is loaded and its symbol resolves right away. The symbol or offset is still resolved as soon as the module is found, so a misspelled symbol fails right away. With `early: true`, it doesn't wait, see [Early Hooking](#early-hooking).

```mermaid
sequenceDiagram
    autonumber
    participant FA as FrookyAgent
    participant NM as NativeHookManager
    participant MO as Module observer
    participant LK as Linker (app thread)

    FA->>NM: resolveHooks(native declarations)

    alt module already loaded (e.g. libc.so)
        NM->>NM: resolve the symbol or offset
        Note over NM: waits for targetReady
        FA-)NM: targetReady resolves
        NM-->>FA: hooks
        FA->>NM: registerHooks(): Interceptor attached
    else module not loaded yet
        NM->>MO: wait for the module (observer attached once)
        LK->>MO: later: onAdded(module), on the loading thread,<br/>before its constructors and JNI_OnLoad run
        MO->>NM: resolve the symbol or offset (from the ELF exports)
        alt targetReady has resolved
            NM->>NM: registerHooks() now, inside the linker
        else before targetReady
            Note over NM: waits for targetReady,<br/>constructors and JNI_OnLoad run unhooked
            FA-)NM: targetReady resolves
            NM->>NM: registerHooks()
        end
        NM-->>FA: hooks
        FA->>NM: registerHooks(): already installed, counted
    end
```

**Source:** [`frooky/agent/src/native/hook/nativeHookManager.ts`](../frooky/agent/src/native/hook/nativeHookManager.ts)

## Blocked Native Functions

Hooking some low-level functions makes the app hang or crash, no matter which settings the hook uses. frooky doesn't install hooks on these functions (or, for `sigprocmask`, doesn't capture their stack traces) and logs a warning instead:

| Function                                                 | Runtime | Blocked      | Why                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pthread_getspecific`, `pthread_setspecific` (`libc.so`) | all     | hook         | Frida's Interceptor uses them itself: installing the hook hangs the app.                                                                                                                                                                       |
| `dlopen` (`libdl.so`)                                    | all     | hook         | The linker picks the namespace by the caller's address, which the hook changes, so system libraries (e.g. graphics drivers) fail to load.                                                                                                      |
| `memset`, `clock_gettime` (`libc.so`)                    | V8      | hook         | V8 calls them itself while it runs a hook, which re-enters V8 and crashes the app (`SIGTRAP`). Use QuickJS to hook them.                                                                                                                       |
| `sigprocmask` (`libc.so`)                                | all     | stack traces | Its calls come from ART's signal chain wrapper in `libsigchain.so`, and Frida's accurate stack walker crashes the app (`SIGSEGV`) when it walks from there, also after `targetReady`. A `callerFilter` still works, as it needs no stack walk. |

**Source:** [`frooky/agent/src/native/hook/nativeHookValidator.ts`](../frooky/agent/src/native/hook/nativeHookValidator.ts) (`BLOCKED_FUNCTIONS`)

## Keeping Hooks Current

Every normalized declaration gets a fingerprint. On a [reload](./additional-features.md#hot-reloading-and-watch-mode), unchanged declarations keep their installed hooks, removed ones are unhooked, and only new, changed or retried ones are resolved. On the first load, every declaration is new and starts in the state `resolving`.

```mermaid
flowchart TD
    reload["hook file changed (-w) or r key:<br/>updateFrookyConfig()"] --> valid{"valid?"}
    valid -->|no| keep["warn, keep the previous version"]
    valid -->|yes| fp["fingerprint per normalized declaration"]
    fp --> known{"fingerprint in the<br/>previous version?"}
    known -->|yes| unchanged["unchanged:<br/>keeps its state and hooks"]
    known -->|"yes, not found, and r key"| retried["retried: resolving"]
    known -->|no| added["new: resolving"]
    fp --> gone["fingerprints only in the previous version:<br/>removed, unregisterHooks()"]
    added --> resolve["resolveHooks()"]
    retried --> resolve
    resolve --> summary["log what changed, e.g.<br/>Updated hooks.yaml: 1 new, 3 unchanged"]
```

A changed declaration has a new fingerprint, so it is removed and added again: its old hooks are unhooked and its new version is resolved and installed. The summary counts such a pair with the same target (method or symbol) as `updated`.

**Source:** [`frooky/agent/src/FrookyAgent.ts`](../frooky/agent/src/FrookyAgent.ts) (diff), [`frooky/runner/watcher.py`](../frooky/runner/watcher.py) (watch mode), [`frooky/runner/runner.py`](../frooky/runner/runner.py) (`r` key)

## Early Hooking

Before `targetReady`, the runtime (ART) is still starting its own threads, and hooks on functions like `read` or `close` collide with them: the app can deadlock or stop responding (ANR). That's why native hooks wait by default.

`early: true` skips this wait. Use it for code that runs before `targetReady`, e.g. ELF constructors in `.init_array`, `JNI_OnLoad` of a library loaded at startup, or anti-tampering checks, and give a high-frequency function a `callerFilter`, see [Dangerous Low-Level, Early, and High-Frequency Hooks](./additional-features.md#dangerous-low-level-early-and-high-frequency-hooks) and the examples in [`08_early_hooking`](./examples/native/08_early_hooking/). `early` only matters when spawning (`-f`): when attaching, the app is already past `targetReady`.

A spawned app goes through three stages:

1. **Paused at spawn:** Frida has started the process suspended. The agent loads the hook files, and none of the app's code runs.
2. **Resumed:** the host has resumed the app and the process starts up, but `targetReady` hasn't resolved yet. The linker can already load libraries.
3. **`targetReady`:** the app's class loader exists and the app's own code is about to run. From here on, the app runs normally.

When attaching, the app is already in stage 3. What can be hooked in each stage:

| Stage                  | Native hooks                                                                                          | Java hooks                                                          | Stack traces                |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------- |
| **1. Paused at spawn** | ⚠️ Only with `early: true`, on modules that are already loaded (e.g. `libc.so`)                       | ✅ Classes of the default class loader (e.g. `javax.crypto.Cipher`) | ❌ Skipped (`before-ready`) |
| **2. Resumed**         | ⚠️ Only with `early: true`, in the linker while a module loads, before `.init_array` and `JNI_OnLoad` | ⏳ App classes stay `resolving`                                     | ❌ Skipped (`before-ready`) |
| **3. `targetReady`**   | ✅ Every waiting hook on a loaded module is installed                                                 | ✅ App classes are looked up in the app's class loaders             | ✅ Java and native          |

Independent of the stage:

- ⚠️ An `early: true` hook on a high-frequency libc function (e.g. `read`, `close`, `malloc`) without a `callerFilter` can deadlock the app or make it stop responding (ANR) during startup. The validator warns about it.
- ⚠️ Hot-path functions (e.g. `malloc`, `free`, `memcpy`) produce a lot of events. A `callerFilter` keeps only the calls of the modules you are interested in, see [Caller Filters](#caller-filters).
- ❌ Stack traces are also skipped while any thread loads a library (`in-linker`, `linker-busy`), on a signal stack (`signal-stack`) and when little stack is left (`low-stack`), see [Skipped Stack Traces](./additional-features.md#skipped-stack-traces).

With `early: true`, a hook is installed as soon as its module is found: before the app is resumed (stage 1) if the module is already loaded, otherwise inside the linker while the module loads (stage 2), so its constructors and `JNI_OnLoad` run hooked.

```mermaid
sequenceDiagram
    autonumber
    participant FA as FrookyAgent
    participant NM as NativeHookManager
    participant MO as Module observer
    participant LK as Linker (app thread)

    FA->>NM: resolveHooks(native declarations with early: true)

    alt module already loaded (e.g. libc.so): stage 1
        NM->>NM: resolve the symbol or offset
        NM-->>FA: hooks
        FA->>NM: registerHooks(): Interceptor attached,<br/>before the app is resumed
    else module not loaded yet: stage 2
        NM->>MO: wait for the module (observer attached once)
        LK->>MO: later: onAdded(module), on the loading thread,<br/>before its constructors and JNI_OnLoad run
        MO->>NM: resolve the symbol or offset (from the ELF exports)
        NM->>NM: registerHooks() now, inside the linker
        Note over LK: constructors and JNI_OnLoad run hooked
        NM-->>FA: hooks
        FA->>NM: registerHooks(): already installed, counted
    end
```

**Source:** [`frooky/agent/src/native/hook/nativeHookManager.ts`](../frooky/agent/src/native/hook/nativeHookManager.ts) (`early`), [`frooky/agent/src/native/unsafeContext.ts`](../frooky/agent/src/native/unsafeContext.ts) (linker watch, unsafe stack contexts)

### Stack Traces Before `targetReady`

Until `targetReady`, `detectUnsafeContext()` returns `before-ready` and hooks record their calls without stack traces, Java and native. The same applies while a thread is loading a library (`in-linker`, `linker-busy`), so calls a hook records inside a constructor or `JNI_OnLoad` have no stack trace either. See [Skipped Stack Traces](./additional-features.md#skipped-stack-traces).

## Caller Filters

A hook's [`callerFilter`](./additional-features.md#caller-filters) decides for every call whether the hook records it. Most calls of a hot function come from code you aren't interested in, so the filter mostly drops calls. What a dropped call costs depends on where the filter runs: in native code, or in JavaScript after Frida has entered the JS engine.

**Source:** [`frooky/agent/src/native/nativeCallerFilter.ts`](../frooky/agent/src/native/nativeCallerFilter.ts) (native `callerFilter` and its ranges), [`frooky/agent/src/native/hook/nativeFilteredListener.ts`](../frooky/agent/src/native/hook/nativeFilteredListener.ts) (`callerFilter` in native code), [`frooky/agent/src/android/androidStackTrace.ts`](../frooky/agent/src/android/androidStackTrace.ts) (Java `callerFilter`)

### The Path of a Native Call

frooky attaches one Frida Interceptor listener per hooked function, no matter how many hooks and hook files declare it. That listener is one of two kinds:

- A **`NativeFilteredListener`**: a small CModule (C code that Frida compiles in the app's process) checks the return address and only calls into JavaScript for calls from a matching module.
- The **JS listener**: Frida enters the JavaScript engine for every call, and the filter is the first thing that runs there.

```mermaid
flowchart TD
    call(["App thread calls a hooked function,<br/>e.g. malloc"]) --> icpt["Frida Interceptor"]
    icpt --> kind{"Listener of<br/>the function?"}

    kind -->|NativeFilteredListener| cmod["CModule on_enter:<br/>return address inside a<br/>matching module?"]
    cmod -->|no| cdrop["filtered++<br/>no JavaScript runs"]
    cmod -->|yes| cb["NativeCallback into JavaScript<br/>with the arguments, return address<br/>and a stack address, no CPU context"]

    kind -->|JS listener| jsenter["JS onEnter:<br/>this.returnAddress, then<br/>passesAnyCallerFilter()"]
    jsenter -->|no| jsdrop["countFilteredCall()<br/>for every hook"]
    jsenter -->|yes| hooks

    cb --> hooks["enterHooks(): each hook checks<br/>its own callerFilter again"]
    hooks --> recorded(["recorded by the matching hooks,<br/>see Capture an Event"])
    cdrop --> orig(["the function runs, nothing recorded"])
    jsdrop --> orig
```

The return address is read when the function is entered: on arm64 it is the link register, on x86 and x86_64 the top of the stack. No stack walk or symbol lookup is needed to filter.

A function can have several hooks, e.g. from two hook files, with different filters. The listener lets a call through if any hook's filter matches it. `enterHooks()` then checks each hook's own `callerFilter` again, so each hook records only its own calls.

Between `onEnter` and `onLeave`, the JS listener keeps a call's state on Frida's invocation context (`this`). The `NativeFilteredListener` stores a call ID in the Interceptor's per-call data instead, and JavaScript keeps the state in a map by that ID. A call with an ID of 0 never calls into JavaScript on leave.

### Which Listener a Function Gets

A call that the `NativeFilteredListener` passes on reaches JavaScript through a `NativeCallback`, not through the Interceptor. Inside it, `this.context` is the callback's own frame, not the hooked call's: the CPU registers of the call are gone. So a function only gets a `NativeFilteredListener` if none of its hooks needs them:

| All hooks of the function...            | Why                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| have a `callerFilter`                   | a hook without one records every call, which has to enter JavaScript anyway                         |
| don't record native stack traces        | the stack walk starts at the call's registers; from the callback, Frida's own frames are in the way |
| don't decode `float` or `double` values | on x86_64 and arm64 they are in the FP registers, which are part of the CPU context                 |
| have at most 16 params                  | the CModule passes up to 16 arguments on                                                            |

Java stack traces (`platformStackTrace`), `argFilter`, `out` params, `errno` and the [checks for unsafe calls](./additional-features.md#skipped-stack-traces) work on both listeners. For the stack checks, the CModule passes an address on the calling thread's stack.

When hooks are added or removed, frooky checks the rules again and swaps the listener if needed, e.g. to the JS listener while a second hook file adds a hook with `nativeStackTrace: true` to the same function, and back once it's removed. With `-vv`, frooky logs which listener a function got and why:

```text
DEBUG  Caller filter on libc.so!malloc: checked in JS, as a hook records native stack traces
DEBUG  Caller filter on libc.so!free: checked in native code
```

If the CModule can't be compiled, every function falls back to the JS listener.

The hook statistics (`i` key) count the calls dropped by either listener in the `Filtered` column.

### Keeping the Module Ranges Current

A native `callerFilter` matches module names, but the listener compares addresses. Each filter keeps the address ranges of the loaded modules whose names match, and updates them when a module is loaded or unloaded:

```mermaid
sequenceDiagram
    participant Linker as Linker (app thread)
    participant MO as Module observer
    participant CF as NativeCallerFilter
    participant NM as NativeHookManager
    participant FL as NativeFilteredListener
    participant C as CModule (any thread)

    Linker->>MO: library loaded, e.g. libapp.so
    MO->>CF: addModule(): name matches a pattern?
    CF->>CF: add [base, base + size) to its ranges
    CF->>NM: onChange()
    NM->>FL: setRanges(ranges of all hooks of the function)
    FL->>FL: write a new table: count, then start and end per module
    FL->>C: replace the table pointer (one write)
    C->>C: next call reads the new table
```

Threads in the CModule read the table without a lock. `setRanges()` therefore never changes a table: it writes a new one and then replaces the pointer, so a thread sees either the old or the new table. The old tables stay allocated, as a thread may still be reading one. Before a matching module is loaded, the table is empty and every call is dropped.

### Caller Filters on Java Hooks

A Java hook has no native listener: frooky replaces the method's implementation with a JavaScript function, so every call enters JavaScript. Its `callerFilter` walks the Java stack and searches it for a matching method (see [Java Hooks](./additional-features.md#java-hooks)), which costs as much as recording `platformStackTrace`. A dropped call still runs the original method, without decoding or an event.

## Capture an Event

> TODO: what happens on a recorded call: decoding the arguments and the return value, stack traces, `argFilter`, the re-entry guard for hook code, and the Java dispatcher. Part of the native path is shown in [The Path of a Native Call](#the-path-of-a-native-call).

**Source:** [`frooky/agent/src/native/hook/nativeHookManager.ts`](../frooky/agent/src/native/hook/nativeHookManager.ts), [`frooky/agent/src/android/hook/androidHookManager.ts`](../frooky/agent/src/android/hook/androidHookManager.ts), [`frooky/agent/src/shared/hook/hookCodeGuard.ts`](../frooky/agent/src/shared/hook/hookCodeGuard.ts), [`frooky/agent/src/native/nativeStackTrace.ts`](../frooky/agent/src/native/nativeStackTrace.ts)

## Collecting Events and Sending Them to the Host

Hooks don't send their events one by one. The agent collects them in a queue, and the event sender sends them as one NDJSON string per batch: as soon as 200 events are queued, and otherwise every 100 ms. Progress reports and crash reports are sent as separate JSON objects.

On the host, the message handler writes every batch to `output.json` as it arrives, then updates the status bar and, with `-e`/`--print-events`, prints the events. Progress reports update the status bar's hook counts. See [Output Format](./output.md) for the events themselves.

**Source:** [`frooky/agent/src/shared/event/eventSender.ts`](../frooky/agent/src/shared/event/eventSender.ts) (event batches), [`frooky/runner/messages.py`](../frooky/runner/messages.py) (agent messages, `output.json`)
