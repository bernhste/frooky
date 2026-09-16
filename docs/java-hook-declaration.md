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

A `JavaHook` declaration is a YAML object with these top level fields:

```yaml
javaClass: <fully qualified Java class name>
hookSettings:                       # Optional. Overrides the file-level `settings.hookSettings` for this group
  <hook settings>
decoderSettings:                    # Optional. Overrides the file-level `settings.decoderSettings` for this group
  <decoder settings>
hooks:
  - <method name>
  - method: <method name>
    overloads:                        # Optional
      - params:
          - <parameter declaration>
    hookSettings:                     # Optional. Overrides the group's hookSettings for this hook only
      <hook settings>
    decoderSettings:                  # Optional. Overrides the group's decoderSettings for this hook only
      <decoder settings>
```

Each item in `hooks` can be written in one of three forms.

Use the **short form** to hook all overloads of a method.

```yaml
javaClass: <fully qualified Java class name>
hooks:
  - <method name>
```

Use the **short form with settings** — a `[<method name>, {<decoder settings>}]` tuple — to hook all overloads of a method while overriding its `decoderSettings`, without switching to the expanded form.

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
> Java hooks have no `retType`. The return type is always resolved from Frida's own Java reflection at hook-registration time.

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
> - **Wildcards:** `org.owasp.*.HttpClient`, at the package level — `*` matches exactly one segment between dots, and every currently loaded class matching the pattern gets hooked
> - **Nested classes:** use the `$` separator, for example `Outer$Inner`

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

`hookSettings` (e.g. `stackTraceLimit`, `stackTraceFilter`) and `decoderSettings` (e.g. `maxRecursion`, `magicDecode`) can be declared at the hook-group level (applying to every hook in the group) or on an individual hook (overriding the group for that hook only). See [Additional Settings and Best Practices](./additional-features.md) for the full list of options and how settings from the file-level `settings`, the hook group, an individual hook, and a parameter are merged together.

**Example:**

```yaml
javaClass: android.database.sqlite.SQLiteDatabase
hookSettings:
  stackTraceLimit: 5
  stackTraceFilter:
    - "^java\\."
    - "^android\\."
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
