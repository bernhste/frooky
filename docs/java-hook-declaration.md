# `JavaHook` Declaration

This documentation explains how to write Java hooks.

<!-- TOC -->

- [Structure](#structure)
- [Basic Usage](#basic-usage)
- [Method Overloads](#method-overloads)
- [Hook and Decoder Settings](#hook-and-decoder-settings)
- [Type Descriptors](#type-descriptors)

<!-- /TOC -->

## Structure

A `JavaHook` declaration is a YAML object with these top-level fields:

```yaml
javaClass: <fully qualified Java class name>
classLoader: <fully qualified ClassLoader class name>   # Optional. See Classes of Custom Class Loaders
hookSettings:                       # Optional. Overrides the file-level `settings.hookSettings` for this hook collection
  <hook settings>
decoderSettings:                    # Optional. Overrides the file-level `settings.decoderSettings` for this hook collection
  <decoder settings>
hooks:
  - <method name>
  - method: <method name>
    overloads:                        # Optional
      - params:
          - <parameter declaration>
        retType: <decoder settings>   # Optional
    hookSettings:                     # Optional. Overrides the hook collection's hookSettings for this hook only
      <hook settings>
    decoderSettings:                  # Optional. Overrides the hook collection's decoderSettings for this hook only
      <decoder settings>
```

Each item in `hooks` can be written in one of three forms.

Use the **short form** to hook all overloads of a method.

```yaml
javaClass: <fully qualified Java class name>
hooks:
  - <method name>
```

Use the **short form with settings** - a `[<method name>, {<decoder settings>}]` tuple - to hook all overloads of a method while overriding its `decoderSettings`, without switching to the expanded form.

```yaml
javaClass: <fully qualified Java class name>
hooks:
  - [<method name>, { <decoder settings> }]
```

Use the **expanded form** when you want to declare specific overloads, or override settings for a single hook.

```yaml
javaClass: <fully qualified Java class name>
hooks:
  - method: <method name>
    overloads:                        # Optional
      - params:
          - <parameter declaration>
```

Each item in `overloads` describes one method signature.

```yaml
params:
  - <parameter declaration>
```

> [!IMPORTANT]
> Please read the documentation on [parameter](./parameter-declaration.md) and [return type](./return-type-declaration.md) declaration to learn how to declare and configure them properly.
>
> There are multiple ways to declare a parameter. In this document, we always use [named parameters](./parameter-declaration.md#named-java-parameters).
>
> Java hooks do not declare a return type because it is always resolved via reflection. To customize how the return value is decoded, pass decoder settings to `retType` on the overload (e.g. `retType: { decoder: string }`). See [Return Type Declaration](./return-type-declaration.md).

## Basic Usage

The minimum required fields are `javaClass` and `hooks`.

```yaml
javaClass: <fully qualified Java class name>
hooks:
  - <method name>
```

This hooks all overloads of each listed method in the specified class.

**Example:**

```yaml
javaClass: android.webkit.WebView
hooks:
  - $init
  - loadUrl
```

This declaration hooks all constructor overloads of `WebView`, plus all overloads of `loadUrl`.

> [!NOTE]
> `$init` is the constructor name.

This declaration hooks the following methods:

```kotlin
WebView(context: Context)
WebView(context: Context, attrs: AttributeSet?)
WebView(context: Context, attrs: AttributeSet?, defStyleAttr: Int)
WebView(context: Context, attrs: AttributeSet?, defStyleAttr: Int, privateBrowsing: Boolean)
WebView(context: Context, attrs: AttributeSet?, defStyleAttr: Int, defStyleRes: Int)
WebView.loadUrl(url: String)
WebView.loadUrl(url: String, additionalHttpHeaders: MutableMap<String!, String!>)
```

> [!TIP]
> Use the following syntax for dynamic class lookup at runtime.
>
> - **Exact match:** `org.owasp.mastestapp.MainActivity`
> - **Wildcards:** `org.owasp.*.HttpClient`, at the package level - `*` matches exactly one segment between dots, or part of one, e.g. `org.owasp.net.*Client`. See [`06_class_wildcards.yaml`](./examples/android/01_basic_hooking/06_class_wildcards.yaml). frooky hooks every matching class of the app and of its class loaders when it resolves the pattern, also classes the app hasn't used yet. If no class matches, it hooks the matching classes of the first class loader the app creates that has any. Reading the class names of a large app takes up to about a second. For a class loader created later, frooky reads them while it is created, which delays its creation by up to about 0.1 seconds for a large one.
> - **Nested classes:** use the `$` separator, for example `Outer$Inner`

## Method Wildcards

A `*` in a method name matches any characters, also none. frooky hooks every overload of each method whose name matches.

**Example:**

```yaml
javaClass: javax.crypto.Cipher
hooks:
  - get*          # getInstance, getIV, getParameters, ...
  - "*Final"      # doFinal
```

> [!NOTE]
>
> - A pattern only matches the methods the class declares itself, not inherited methods (e.g. `wait` or `hashCode` of `java.lang.Object`) and not constructors. Hook those by name, e.g. `$init`.
> - YAML reads a value that starts with `*` as an alias, so quote it: `"*Final"`.
> - With `overloads`, frooky hooks these overloads of each matching method that has them, and skips the others.
> - Methods that frooky never hooks because a hook breaks the app (e.g. `System.loadLibrary`) are skipped with a warning, also when a pattern matches them.
> - A pattern also works with a class wildcard, e.g. `javaClass: org.owasp.*.HttpClient` with `send*`.

## Class Loaders

frooky looks a class up in every class loader of the app, not only in the app's own:

- **Classes of the app and of Android** are found right away.
- **Classes in a class loader the app creates later**, such as a plugin, code the app downloads and loads with `DexClassLoader`, or the WebView implementation, are hooked while that class loader is created, before any of its code runs.
- **A class that no class loader has yet** keeps waiting: frooky reports it as waiting after `-t` seconds and hooks it as soon as a class loader has it. See [Dynamic Class and Module Resolution](./additional-features.md#dynamic-class-and-module-resolution).

### Classes of Custom Class Loaders

Some apps load classes with a class loader of their own that extends `ClassLoader` directly and defines classes itself, for example with `DexFile.loadClass()`. frooky doesn't see these classes on its own. The same goes for a class that exists in several class loaders: frooky hooks the first one it finds, usually the app's.

Name the class loader in `classLoader`, and frooky hooks the class only as instances of that class loader load it, before `loadClass()` returns it:

```yaml
javaClass: org.owasp.mastestapp.PluginGreeter
classLoader: org.owasp.mastestapp.PluginClassLoader
hooks:
  - greet
```

frooky hooks `loadClass(String)` of that class loader, or the one it inherits, which runs for every class it loads. See [`04_custom_class_loaders.yaml`](./examples/android/01_basic_hooking/04_custom_class_loaders.yaml).

To hook all overloads of a method while also overriding its `decoderSettings`, write the hook as a `[<method name>, {<decoder settings>}]` tuple instead of a plain string.

**Example:**

```yaml
javaClass: javax.crypto.Cipher
hooks:
  - [doFinal, { decoder: "string" }]
```

This hooks all overloads of `Cipher.doFinal`, decoding the plaintext/ciphertext byte arrays passed to and returned from it as strings.

## Method Overloads

To hook only specific overloads of a method, use the expanded form and provide a list of overload declarations under `overloads`.

```yaml
javaClass: <fully qualified Java class name>
hooks:
  - method: <method name>
    overloads:                        # Optional
      - params:
          - <parameter declaration>
```

Each item in `overloads` matches one overloaded method signature including the relevant [parameter declarations](./parameter-declaration.md).

**Example:**

```yaml
javaClass: android.content.Intent
hooks:
  - method: putExtra
    overloads:
      - params:
          - ["java.lang.String", name]
          - ["java.lang.String", value]
      - params:
          - ["java.lang.String", name]
          - ["[Z", value]
```

This hooks **only** the following methods:

```kotlin
Intent.putExtra(name: String!, value: String?): Intent
Intent.putExtra(name: String!, value: BooleanArray?): Intent
```

## Hook and Decoder Settings

`hookSettings` (e.g. `platformStackTrace`, `maxStackFrames`, `callerFilter`) and `decoderSettings` (`maxDepth`, `maxItems`, `decoder`) can be declared on the hook collection (applying to every hook in it) or on an individual hook (overriding the hook collection for that hook only). See [Additional Features](./additional-features.md#settings-precedence), [Decoders](./decoders.md) and [Decoders for Android Java Hooks](./decoders-java.md) for the full list of options and how the file-level `settings`, the hook collection, an individual hook, and a parameter or return type are merged together.

**Example:**

```yaml
javaClass: android.database.sqlite.SQLiteDatabase
hookSettings:
  platformStackTrace: true
  maxStackFrames: 5
  callerFilter:
    - org.owasp.mastestapp
hooks:
  - method: query
    overloads:
      - params:
          - ["java.lang.String", table]
          - ["[Ljava.lang.String;", columns]
```

## Type Descriptors

Frida, and therefore frooky, uses custom type descriptors based on the internal [JVM field type descriptor](https://docs.oracle.com/javase/specs/jvms/se19/html/jvms-4.html#jvms-4.3.2).

The following table shows how types are represented in Java, the JVM, and Frida or frooky.

| Kind of Type      | Java Type Descriptor                                                                         | JVM Type Descriptor                                         | Frida / frooky Type Descriptor                                                               |
| ----------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Primitive         | `boolean`<br>`byte`<br>`char`<br>`short`<br>`int`<br>`long`<br>`float`<br>`double`<br>`void` | `Z`<br>`B`<br>`C`<br>`S`<br>`I`<br>`J`<br>`F`<br>`D`<br>`V` | `boolean`<br>`byte`<br>`char`<br>`short`<br>`int`<br>`long`<br>`float`<br>`double`<br>`void` |
| Primitive Array   | `boolean[]`<br>`byte[]`<br>...                                                               | `[Z`<br>`[B`<br>...                                         | `[Z`<br>`[B`<br>...                                                                          |
| Reference         | `java.lang.Object`<br>`org.owasp.MyClass`<br>...                                             | `Ljava/lang/Object;`<br>`Lorg/owasp/MyClass;`<br>...        | `java.lang.Object`<br>`org.owasp.MyClass`<br>...                                             |
| Reference Array   | `Object[]`<br>`MyClass[]`<br>...                                                             | `[Ljava/lang/Object;`<br>`[Lorg/owasp/MyClass;`<br>...      | `[Ljava.lang.Object`<br>`[Lorg.owasp.MyClass`<br>...                                         |
| Multi-Dimensional | `int[][]`<br>`String[][]`<br>...                                                             | `[[I`<br>`[[Ljava/lang/String;`<br>...                      | `[[int`<br>`[[Ljava.lang.String`<br>...                                                      |

> [!NOTE]
> Frida uses a hybrid notation that combines JVM-style array prefixes (`[`) with Java-style class names (dot-separated rather than slash-separated, without the `L` prefix and `;` suffix).
