# Parameter Declaration

frooky needs to know a function or method's signature to hook it correctly. Part of this signature is the parameter list, which includes the types and names of the arguments passed to the function or method. This documentation explains how to declare parameters.

There are different accepted ways to declare a parameter. The following chapters explain them.

<!-- TOC -->

- [Unnamed Parameters](#unnamed-parameters)
  - [Unnamed Java Parameters](#unnamed-java-parameters)
  - [Unnamed Native Parameters](#unnamed-native-parameters)
- [Named Parameters](#named-parameters)
  - [Named Java Parameters](#named-java-parameters)
  - [Named Native Parameters](#named-native-parameters)
- [Decoders](#decoders)

<!-- /TOC -->

## Unnamed Parameters

This is the simplest declaration, based solely on its type:

```yaml
params: [ <type> ]
```

frooky will try to decode the arguments based on the provided type.

### Unnamed Java Parameters

```yaml
javaClass: android.webkit.WebView
hooks:
  - method: $init
    overloads:
      - params: [ android.content.Context ]
      - params: [ android.content.Context, android.util.AttributeSet, int, boolean ]
```

This example hooks the following constructors from the [Android Java Library](https://developer.android.com/reference/kotlin/android/webkit/WebView#public-constructors):

```kotlin
WebView(context: Context)
WebView(context: Context, attrs: AttributeSet?, defStyleAttr: Int, privateBrowsing: Boolean)
```

### Unnamed Native Parameters

```yaml
module: sqlite3.so
hooks:
  - symbol: sqlite3_exec
    retType: int
    params: [ "sqlite3*", "const char *", "void *", "void *", "char **" ]
```

This example hooks the following method from the [SQLite function](https://sqlite.org/c3ref/exec.html):

```c
int sqlite3_exec(
  sqlite3*,                                  /* An open database */
  const char *sql,                           /* SQL to be evaluated */
  int (*callback)(void*,int,char**,char**),  /* Callback function */
  void *,                                    /* 1st argument to callback */
  char **errmsg                              /* Error msg written here */
);
```

## Named Parameters

If you want to declare the name of the parameter, you must use an array for the type and name pair.

```yaml
params:
  - [ <type>, <name> ]
```

The following chapters use the same examples described in [Unnamed Parameters](#unnamed-parameters) but add parameter names.

> [!TIP]
> Technically, the name of an argument is not required, but it is recommended to declare the name as well, as this makes a declaration easier to read and provides more context in the output of frooky.

### Named Java Parameters

```yaml
javaClass: android.webkit.WebView
hooks:
  - method: $init
    overloads:
      - params:
        - [ android.content.Context, context ]
        - [ android.util.AttributeSet, attrs ]
        - [ int, defStyleAttr ]
        - [ boolean, privateBrowsing ]
```

This example hooks the following constructors from the [Android Java Library](https://developer.android.com/reference/kotlin/android/webkit/WebView#public-constructors):

```kotlin
WebView(context: Context, attrs: AttributeSet?, defStyleAttr: Int, privateBrowsing: Boolean)
```

### Named Native Parameters

```yaml
module: sqlite3.so
hooks:
  - symbol: sqlite3_exec
    retType: int
    params:
      - "sqlite3*"
      - [ "const char *", sql ]
      - [ "void *", callback ]
      - "void *"
      - [ "char **", "errmsg" ]
```

This example hooks the following method from the [SQLite function](https://sqlite.org/c3ref/exec.html):

```c
int sqlite3_exec(
  sqlite3*,                                  /* An open database */
  const char *sql,                           /* SQL to be evaluated */
  int (*callback)(void*,int,char**,char**),  /* Callback function */
  void *,                                    /* 1st argument to callback */
  char **errmsg                              /* Error msg written here */
);
```

## Decoders

When hooking a method, frooky tries to decode arguments as well as return values. This is done using decoders, which can be configured per parameter, for example to control the time of decoding or to pass additional context.

See [Decoders](./decoders.md) for what decoders are, the full list of decoder settings, and how to configure them on a parameter.
