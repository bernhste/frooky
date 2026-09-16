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
  - [`direction`-Option: Declare the Time of Decoding](#direction-option-declare-the-time-of-decoding)
    - [Explicit Time of Decoding in Java](#explicit-time-of-decoding-in-java)
    - [Explicit Time of Decoding in Native](#explicit-time-of-decoding-in-native)
  - [`decoderArg`-Option: Pass Arguments to Decoder](#decoderarg-option-pass-arguments-to-decoder)
    - [Pass Arguments to Decoder in Java](#pass-arguments-to-decoder-in-java)
    - [Pass Arguments to Decoder in Native](#pass-arguments-to-decoder-in-native)
  - [`decoder`-Option: Override the Decoder](#decoder-option-override-the-decoder)

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

When hooking a method, frooky tries to decode arguments as well as return values. Depending on the type, this can be fairly simple. Primitives, such as Integers, Floats, or Shorts, can always be decoded by the frooky agent. However, some values require more complex decoders.

These are required when the time of decoding varies, or when more context information is needed. The following two chapters explain these cases.

You can configure a decoder by adding a decoder configuration object to a parameter declaration.

This is done using a decoder configuration added to any [unnamed](#unnamed-parameters) and [named](#named-parameters) parameters. It can contain `direction` plus any of the [decoder settings](./additional-features.md#decoder-settings):

- `direction`
- `maxRecursion`
- `decodeLimit`
- `magicDecode`
- `fastDecode`
- `decoder`
- `decoderArg`
- `paramFilter`

```yaml
params:
  - [ <type>,                                    # Parameter type
      <name>,                                    # Parameter name
      {                                          # Decoder configuration
        direction: <in|out|inout>,               # When to decode the parameter. Default: in
        decoderArg: <param_name>                 # Argument passed to the decoder. Must be a valid parameter name
      }
    ]
```

The following chapters will explain the concepts through practical examples.

### `direction`-Option: Declare the Time of Decoding

By default, arguments are decoded when the function or method is called. Larger data structures, such as arrays, are often passed by reference to allow manipulation within the function or method, as the following example shows:

```java
public final int doFinal(byte[] output,
                         int outputOffset)
```

This Java method from the class `javax.crypto.Cipher` encrypts or decrypts the data stored in the current object and writes the output to the byte array `output`. To access the encrypted or decrypted `output`, you must decode the value after the method completes.

To accommodate these cases, you can specify the timing of decoding using the following decoder options:

- After the function or method completes (`direction: out`)
- Both at the beginning and after the function or method completes (`direction: inout`)

#### Explicit Time of Decoding in Java

```yaml
javaClass: javax.crypto.Cipher
hooks:
  - method: doFinal
    overloads:
      - params:
        - [ "[B", output, { direction: out } ]
        - [ int, outputOffset ]
```

This example hooks the following method from the [Android Java Library](<https://developer.android.com/reference/javax/crypto/Cipher?hl=en#doFinal(byte[],%20int)>):

```java
public final int doFinal (byte[] output,
                          int outputOffset)
```

In order to access the decrypted data, the `output` parameter must be decoded at exit.

#### Explicit Time of Decoding in Native

```yaml
module: libsystem_c.dylib
hooks:
  - symbol: realpath
    params:
      - [ "const char *restrict", file_name ]
      - [ "char *restrict", resolved_name, { direction: out } ]
```

This example hooks the following method from the [C standard library on iOS](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/realpath.3.html):

```c
char *realpath(const char *restrict file_name,
               char *restrict resolved_name);
```

The `resolved_name` parameter must be decoded at exit because it contains an absolute pathname after resolution.

### `decoderArg`-Option: Pass Arguments to Decoder

In native functions, primitive arrays are passed by reference. In some cases, we need additional context to decode the parameter.

A common example is the length of a buffer. If the buffer is not terminated by a symbol such as `\0` for C strings, the decoder must know the length at runtime. Usually, this information is passed to the function or method. The following example illustrates this pattern from the [OpenSSL library](https://docs.openssl.org/3.0/man3/EVP_EncryptInit/):

```c
int EVP_EncryptUpdate(EVP_CIPHER_CTX *ctx,       // Cipher context
                      unsigned char *out,        // Output buffer
                      int *outl,                 // Length of the output buffer
                      const unsigned char *in,   // Input buffer
                      int inl);                  // Length of the input buffer
```

This function encrypts `inl` bytes from the `in` buffer and writes the encrypted result to the `out` buffer. Depending on the encryption algorithm used, it is unclear how many bytes will be written when the function is called.

If we want to decode the `out` buffer, we must pass its length (`outl`) to the buffer decoder.

#### Pass Arguments to Decoder in Java

```yaml
javaClass: java.io.FileInputStream
hooks:
  - method: read
    overloads:
      - params:
        - [ "[B", buffer, { decoderArg: len } ]
        - [ int, off ]
        - [ int, len ]
```

This example hooks the following method from the [Android Java Library](<https://developer.android.com/reference/java/io/FileInputStream#read(byte[],%20int,%20int)>):

```java
public int read (byte[] b,
                 int off,
                 int len)
```

The decoder for `buffer` receives `len` to indicate how many bytes were actually read.

#### Pass Arguments to Decoder in Native

```yaml
module: libssl.so
hooks:
  - symbol: EVP_DigestFinal_ex
    retType: int
    params:
      - [ "EVP_MD_CTX *", ctx ]
      - [ "unsigned char *", md, { direction: out, decoderArg: ctx } ]
      - [ "unsigned int *", s ]
```

This example hooks the following method from [OpenSSL](https://docs.openssl.org/1.0.2/man3/EVP_DigestInit):

```c
int EVP_DigestFinal_ex(EVP_MD_CTX *ctx,
                       unsigned char *md,
                       unsigned int *s);
```

This function retrieves the digest data from `ctx` and moves it into `md`. So in order to decode `md`, we need to know the type of the digest algorithm or the size of the digest, hence we pass `ctx`.

### `decoder`-Option: Override the Decoder

For some Java types, frooky's built-in decoders are not sufficient to give the captured value meaningful context (for example, a bitmask `int` where the individual flags matter more than the raw number). In these cases, you can select one of frooky's registered custom decoders by name using `decoder`.

> [!NOTE]
> `decoder` is currently only implemented for Java hooks.

```yaml
javaClass: android.content.Intent
hooks:
  - method: setFlags
    overloads:
      - params:
        - [int, flags, { decoder: android.content.IntentFlagDecoder }]
```

This decodes the `flags` argument of [`Intent.setFlags(int)`](<https://developer.android.com/reference/android/content/Intent#setFlags(int)>) using the `android.content.IntentFlagDecoder`, which resolves the individual `Intent.FLAG_*` constants set in the bitmask instead of just reporting the raw integer.

Native hooks will support the same option once implemented, for example to decode a `byte *` using the built-in `toStringDecoder`:

```yaml
params:
  - [byte *, name, { decoder: toStringDecoder }]
```
