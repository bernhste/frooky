# Decoders

<!-- TOC -->

- [What Are Decoders?](#what-are-decoders)
- [Decoder Settings](#decoder-settings)
  - [`direction`: Declare the Time of Decoding](#direction-declare-the-time-of-decoding)
  - [`decoderArg`: Pass Arguments to Decoder](#decoderarg-pass-arguments-to-decoder)
  - [`decoder`: Override the Default Decoder](#decoder-override-the-default-decoder)
- [Decoders for Return Types](#decoders-for-return-types)
  - [Native Return Type Decoders](#native-return-type-decoders)
  - [Java Return Type Decoders](#java-return-type-decoders)

<!-- /TOC -->

## What Are Decoders?

frooky uses decoders to turn the raw arguments and return values captured at a hook into strucutred output. Decoders are used to decode both parameters and return values.

Depending on the type, this can be fairly simple. Primitives, such as Integers, Floats, or Shorts, can always be decoded by the frooky agent. However, some values require more complex decoders — for example when the time of decoding varies, or when more context information is needed to decode a value correctly.

frooky comes with a set of decoders for various use cases. By default, frooky chosses the best fitting decoder for the type. But you can change what decoder is used or its settings.

## Decoder Settings

A decoder's behavior is controlled by `decoderSettings`:

| Setting        | Type       | Default     | Description                                                                                                             |
| -------------- | ---------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `decoder`      | `string`   | `undefined` | Overrides the type decoder with a registered custom decoder. Java only, see [`decoder`](#decoder-override-the-decoder). |
| `decoderArg`   | `string`   | `undefined` | Name of another parameter passed to this parameter's decoder for additional context (e.g. a buffer's length).           |
| `maxRecursion` | `number`   | `10`        | Maximum recursion depth when decoding nested structures (nested arrays, lists, maps, structs, etc.).                    |
| `decodeLimit`  | `number`   | `100`       | Maximum number of elements decoded from lists, arrays, collections, maps, etc.                                          |
| `paramFilter`  | `string[]` | `undefined` | Regular expressions; the event for this hook is only captured if the decoded value matches one of them.                 |

When settings are attached to a parameter or a return type, an additional `direction` field is available, see [`direction`](#direction-declare-the-time-of-decoding).

`decoderSettings` can be declared at multiple levels of a hook file (file-level, hook group, individual hook, or per-parameter/return-type). See [Settings Precedence](./additional-features.md#settings-precedence) for how these levels combine. The following chapters explain the settings that need more context through practical examples.

### `direction`: Declare the Time of Decoding

By default, arguments are decoded when the function or method is called. Larger data structures, such as arrays, are often passed by reference so the function or method can write a result into them. In these cases, decode the parameter after completion using `direction: out`, or both at the beginning and after completion using `direction: inout`.

In Java, [`MessageDigest.digest(byte[], int, int)`](<https://developer.android.com/reference/java/security/MessageDigest#digest(byte[],%20int,%20int)>) computes the hash and writes it into `buf`, so `buf` must be decoded at exit:

```yaml
javaClass: java.security.MessageDigest
hooks:
  - method: digest
    overloads:
      - params:
        - [ "[B", buf, { direction: out } ]
        - [ int, offset ]
        - [ int, len ]
```

In native code, OpenSSL's [`RAND_bytes`](https://docs.openssl.org/3.0/man3/RAND_bytes/) fills `buf` with `num` random bytes, so `buf` is only meaningful after the call:

```yaml
module: libcrypto.so
hooks:
  - symbol: RAND_bytes
    retType: int
    params:
      - [ "unsigned char *", buf, { direction: out } ]
      - [ int, num ]
```

### `decoderArg`: Pass Arguments to Decoder

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

The second example hooks the following method from [OpenSSL](https://docs.openssl.org/1.0.2/man3/EVP_DigestInit):

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

```c
int EVP_DigestFinal_ex(EVP_MD_CTX *ctx,
                       unsigned char *md,
                       unsigned int *s);
```

This function retrieves the digest data from `ctx` and moves it into `md`. So in order to decode `md`, we need to know the type of the digest algorithm or the size of the digest, hence we pass `ctx`.

### `decoder`: Override the Default Decoder

For some Java types, frooky's built-in decoders are not sufficient to give the captured value meaningful context (for example, a bitmask `int` where the individual flags matter more than the raw number). In these cases, you can select one of frooky's registered custom decoders by name using `decoder`.

> [!NOTE]
> The currently registered decoders are:
>
> - `string`: decodes a `byte[]` as text, or calls `toString()` on any other reference type
> - `hashCode`: renders a reference type as `<class>@<hashCode>`, without invoking a custom `toString()` override
> - `intentFlag`: decodes an `int` bitmask into the matching `Intent.FLAG_*` constant names
> - `intentUriFlag`: decodes an `int` bitmask into the matching `Intent.URI_*` constant names
> - `constant`: decodes a value into the name of the matching `static final` constant declared on the hooked method's own class (e.g. `1` -> `"ENCRYPT_MODE"` for `javax.crypto.Cipher`'s `opmode`)
>
> A more flexible, user-extensible custom decoder framework is in the works.

```yaml
javaClass: android.content.Intent
hooks:
  - method: setFlags
    overloads:
      - params:
        - [int, flags, { decoder: intentFlag }]
```

This decodes the `flags` argument of [`Intent.setFlags(int)`](<https://developer.android.com/reference/android/content/Intent#setFlags(int)>) using the `android.content.IntentFlagDecoder`, which resolves the individual `Intent.FLAG_*` constants set in the bitmask instead of just reporting the raw integer.

The `constant` decoder resolves any value to the name of the constant with that value, declared on the same class the hook is on - no class needs to be specified:

```yaml
javaClass: javax.crypto.Cipher
hooks:
  - method: init
    overloads:
      - params:
        - [int, opmode, { decoder: constant }]
        - [java.security.Key, key]
```

This decodes the `opmode` argument of [`Cipher.init(int, Key)`](<https://developer.android.com/reference/javax/crypto/Cipher#init(int,%20java.security.Key)>) to `"ENCRYPT_MODE"`, `"DECRYPT_MODE"`, etc. instead of the raw `int`, by matching it against `Cipher`'s own declared constants.

Native hooks will support the same option once implemented, for example to decode a `byte *` using the built-in `toStringDecoder`:

```yaml
params:
  - [byte *, name, { decoder: string }]
```

## Decoders for Return Types

Return values are always decoded once the function or method completes (see [Return Type Declaration](./return-type-declaration.md)). To customize how a return value is decoded, add `decoderSettings` to the `retType`.

### Native Return Type Decoders

Use a `[ type, {decoderSettings} ]` tuple instead of a plain type:

```yaml
module: libssl.so
hooks:
  - symbol: EVP_DigestFinal_ex
    retType: [ int, { decoder: exitCode } ]
    params:
      - [ "EVP_MD_CTX *", ctx ]
      - [ "unsigned char *", md ]
      - [ "unsigned int *", s ]
```

### Java Return Type Decoders

In Java, the method signature can be retrieved at runtime, so you never declare the return type itself. If you want to customize how the return value is decoded, add a `retType` object containing only `decoderSettings` to the overload:

```yaml
javaClass: android.content.Intent
hooks:
  - method: getFlags
    overloads:
      - params: []
        retType: { decoder: intentFlags }
```

This example hooks the following method from the [Android Java Library](<https://developer.android.com/reference/android/content/Intent#getFlags()>):

```java
public int getFlags ()
```

`getFlags()` returns a raw bitmask `int`. Instead of reporting the raw number, the return value is decoded using the built in `intentFlags` decoder which resolves the individual `Intent.FLAG_*` constants set in the bitmask.
