# Parameter Declaration

`params` lists the parameters of a method or function, in order. In Java hooks, their types select the [overload](./java-hook-declaration.md#method-overloads). In native hooks, they tell frooky how to read the arguments, since a native function has no type information at runtime.

<!-- TOC -->

- [Forms](#forms)
- [Java Parameters](#java-parameters)
- [Native Parameters](#native-parameters)
- [Decoder Settings](#decoder-settings)

<!-- /TOC -->

## Forms

| Form                   | Example                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| Type                   | `int`                                                                       |
| Type + name            | `[int, len]`                                                                |
| Type + settings        | `["[B", { maxItems: 32 }]`                                                  |
| Type + name + settings | `["void *", buf, { direction: out, decoderArgs: { length: len } }]`         |
| Object                 | `{ type: "void *", name: buf, direction: out, settings: { maxItems: 32 } }` |

In the tuple forms, `direction` is one of the settings. In the object form, it's a field of its own next to `settings`.

The name is optional, but name your parameters: events show it next to the value, and [`decoderArgs`](./decoders.md#decoderargs-pass-values-to-the-decoder-by-role) refers to other parameters by it. A name that `decoderArgs` refers to must be unique within the hook.

In YAML, quote a type that starts with `[` (`"[B"`) or contains `*` or `[]` (`"char *"`, `"char *const []"`).

## Java Parameters

Java types are written as [type descriptors](./java-hook-declaration.md#type-descriptors):

```yaml
javaClass: android.webkit.WebView
hooks:
  - method: $init
    overloads:
      - params:
          - [android.content.Context, context]
      - params:
          - [android.content.Context, context]
          - [android.util.AttributeSet, attrs]
          - [int, defStyleAttr]
          - [boolean, privateBrowsing]
```

This hooks these two [constructors](https://developer.android.com/reference/kotlin/android/webkit/WebView#public-constructors):

```kotlin
WebView(context: Context)
WebView(context: Context, attrs: AttributeSet?, defStyleAttr: Int, privateBrowsing: Boolean)
```

frooky decodes a Java argument by its runtime class, not by the declared type, see [How frooky Picks a Java Decoder](./decoders-java.md#how-frooky-picks-a-java-decoder). Without `overloads`, every overload is hooked and its parameters are taken from reflection, without names.

## Native Parameters

Native types are written as in C. Parameters without a name can be mixed with named ones:

```yaml
module: libsqlite.so
hooks:
  - symbol: sqlite3_exec
    retType: int
    params:
      - "sqlite3 *"
      - ["const char *", sql]
      - ["void *", callback]
      - "void *"
      - ["char **", errmsg]
```

This hooks [`sqlite3_exec`](https://sqlite.org/c3ref/exec.html):

```c
int sqlite3_exec(
  sqlite3*,                                  /* An open database */
  const char *sql,                           /* SQL to be evaluated */
  int (*callback)(void*,int,char**,char**),  /* Callback function */
  void *,                                    /* 1st argument to callback */
  char **errmsg                              /* Error msg written here */
);
```

Declare the parameters up to the last one you want to decode; the ones after it can be left out. How each type is decoded is described in [Decoders for Native Hooks](./decoders-native.md#how-frooky-picks-a-decoder).

## Decoder Settings

The settings of a parameter override the decoder settings of its hook, collection and file. Only a parameter can have `direction`, `decoderArgs` and `argFilter`:

```yaml
params:
  - [<type>, <name>, { direction: out, decoderArgs: { length: $ret }, maxItems: 256 }]
```

See [Decoder Settings](./decoders.md#decoder-settings) for every setting.
