# `JavaHook` Declaration

A Java hook collection hooks methods of one Java class.

<!-- TOC -->

- [Structure](#structure)
- [Basic Usage](#basic-usage)
- [Class Wildcards](#class-wildcards)
- [Method Wildcards](#method-wildcards)
- [Method Overloads](#method-overloads)
- [Class Loaders](#class-loaders)
  - [Classes of Custom Class Loaders](#classes-of-custom-class-loaders)
- [Hook and Decoder Settings](#hook-and-decoder-settings)
- [Type Descriptors](#type-descriptors)

<!-- /TOC -->

## Structure

```yaml
javaClass: <fully qualified class name>
classLoader: <fully qualified ClassLoader class name>   # Optional, see Classes of Custom Class Loaders
hookSettings:                       # Optional. Override the file's settings for this collection
  <hook settings>
decoderSettings:                    # Optional
  <decoder settings>
hooks:
  - <method name>                                     # short form
  - [<method name>, { <decoder settings> }]           # short form with settings
  - method: <method name>                             # expanded form
    overloads:                      # Optional. Default: all overloads
      - params:
          - <parameter declaration>
        retType: <decoder settings> # Optional
    hookSettings:                   # Optional. Override the collection's settings for this hook
      <hook settings>
    decoderSettings:                # Optional
      <decoder settings>
```

| Form                | Hooks                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Short               | All overloads of the method                                                 |
| Short with settings | All overloads of the method, with its own `decoderSettings`                 |
| Expanded            | The overloads listed in `overloads` (all without it), with its own settings |

Java hooks declare no return type: frooky gets it by reflection. `retType` only takes decoder settings, see [Return Type Declaration](./return-type-declaration.md#java-return-types). Parameters are described in [Parameter Declaration](./parameter-declaration.md).

## Basic Usage

```yaml
javaClass: android.webkit.WebView
hooks:
  - $init
  - loadUrl
```

This hooks every overload of the `WebView` constructor and of `loadUrl`:

```kotlin
WebView(context: Context)
WebView(context: Context, attrs: AttributeSet?)
WebView(context: Context, attrs: AttributeSet?, defStyleAttr: Int)
WebView(context: Context, attrs: AttributeSet?, defStyleAttr: Int, privateBrowsing: Boolean)
WebView(context: Context, attrs: AttributeSet?, defStyleAttr: Int, defStyleRes: Int)
WebView.loadUrl(url: String)
WebView.loadUrl(url: String, additionalHttpHeaders: MutableMap<String!, String!>)
```

- `$init` is the constructor. Events and hook statistics name constructors `$init` too.
- A nested class is written with `$`, e.g. `android.security.keystore.KeyGenParameterSpec$Builder`.

The short form with settings changes the decoder settings of one method:

```yaml
javaClass: javax.crypto.Cipher
hooks:
  - [doFinal, { decoder: string }]
```

This decodes the `byte[]` arguments and return values of every `doFinal` overload as text.

## Class Wildcards

A `*` in `javaClass` matches one package segment or part of one, e.g. `org.owasp.*.HttpClient` or `org.owasp.net.*Client`. It never matches across a `.`.
A `**` matches across package segments, e.g. `android.**` hooks all matching classes in `android` and its subpackages, and `org.owasp.**.HttpClient` matches any package depth including none (`org.owasp.HttpClient`).

- frooky hooks every matching class of the app and of its class loaders, also classes the app hasn't used yet.
- If no class matches, frooky hooks the matching classes of the first class loader the app creates that has any.
- Reading the class names of a large app takes up to about a second. For a class loader created later, frooky reads them while it is created, which delays it by up to about 0.1 seconds.

See [`06_class_wildcards.yaml`](./examples/android/01_basic_hooking/06_class_wildcards.yaml).

## Method Wildcards

A `*` or `**` in a method name matches any characters, also none. frooky hooks every overload of each matching method.

```yaml
javaClass: javax.crypto.Cipher
hooks:
  - get*          # getInstance, getIV, getParameters, ...
  - "*Final"      # doFinal
```

- A pattern only matches the methods the class declares itself, not inherited ones (e.g. `hashCode` of `java.lang.Object`) and not constructors. Hook those by name.
- YAML reads a value that starts with `*` as an alias, so quote it: `"*Final"`.
- With `overloads`, frooky hooks the listed overloads of each matching method that has them.
- Methods that frooky never hooks (e.g. `System.loadLibrary`, see [Blocked Functions](./additional-features.md#blocked-functions)) are skipped with a warning, also when a pattern matches them.
- Method and class wildcards can be combined, e.g. `javaClass: org.owasp.*.HttpClient` with `send*`.

See [`05_method_wildcards.yaml`](./examples/android/01_basic_hooking/05_method_wildcards.yaml).

## Method Overloads

To hook only some overloads, list their parameters under `overloads`:

```yaml
javaClass: android.content.Intent
hooks:
  - method: putExtra
    overloads:
      - params:
          - [java.lang.String, name]
          - [java.lang.String, value]
      - params:
          - [java.lang.String, name]
          - ["[Z", value]
```

This hooks only these two overloads:

```kotlin
Intent.putExtra(name: String!, value: String?): Intent
Intent.putExtra(name: String!, value: BooleanArray?): Intent
```

The parameter types must match the method's exactly, written as [type descriptors](#type-descriptors). An overload that doesn't exist is skipped with a warning.

## Class Loaders

frooky looks a class up in every class loader of the app, not only in the app's own:

- **Classes of the app and of Android** are found right away.
- **Classes in a class loader the app creates later**, such as a plugin, downloaded code loaded with `DexClassLoader`, or the WebView implementation, are hooked while that class loader is created, before any of its code runs.
- **A class that no class loader has yet** is reported as waiting once the app has started, and hooked as soon as a class loader has it. See [Resolve the Module or Class](./under-the-hood.md#resolve-the-module-or-class).

### Classes of Custom Class Loaders

frooky doesn't see the classes of a class loader that extends `ClassLoader` directly and defines classes itself, e.g. with `DexFile.loadClass()`. A class that exists in several class loaders is hooked in the first one frooky finds, usually the app's.

For both, name the class loader in `classLoader`. frooky then hooks the class only as instances of that class loader load it, before `loadClass()` returns it:

```yaml
javaClass: org.owasp.mastestapp.PluginGreeter
classLoader: org.owasp.mastestapp.PluginClassLoader
hooks:
  - greet
```

See [`04_custom_class_loaders.yaml`](./examples/android/01_basic_hooking/04_custom_class_loaders.yaml).

## Hook and Decoder Settings

`hookSettings` and `decoderSettings` can be set on the collection, for all its hooks, or on a hook in the expanded form, overriding the collection. See [Settings Precedence](./additional-features.md#settings-precedence), [Stack Traces](./additional-features.md#stack-traces), [Caller Filters](./additional-features.md#caller-filters) and [Decoders](./decoders.md).

```yaml
javaClass: android.database.sqlite.SQLiteDatabase
hookSettings:
  platformStackTrace: true
  maxStackFrames: 5
  callerFilter:
    - ^org\.owasp\.mastestapp\.
hooks:
  - method: query
    overloads:
      - params:
          - [java.lang.String, table]
          - ["[Ljava.lang.String;", columns]
```

## Type Descriptors

Parameter types are written like Frida writes them: a primitive or a class by its Java name, an array by its [JVM descriptor](https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-4.html#jvms-4.3.2), with dots in class names.

| Java type          | Type descriptor       |
| ------------------ | --------------------- |
| `int`, `boolean`   | `int`, `boolean`      |
| `java.lang.String` | `java.lang.String`    |
| `Outer.Inner`      | `Outer$Inner`         |
| `byte[]`           | `[B`                  |
| `String[]`         | `[Ljava.lang.String;` |
| `int[][]`          | `[[I`                 |

The element types of arrays: `Z` (`boolean`), `B` (`byte`), `C` (`char`), `S` (`short`), `I` (`int`), `J` (`long`), `F` (`float`), `D` (`double`) and `L<class>;`. Quote a descriptor that starts with `[` in YAML, e.g. `"[B"`.
