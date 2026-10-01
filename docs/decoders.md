# Decoders

<!-- TOC -->

- [What Are Decoders?](#what-are-decoders)
- [How frooky Picks a Decoder](#how-frooky-picks-a-decoder)
  - [Built-in Java Decoders](#built-in-java-decoders)
- [Decoder Settings](#decoder-settings)
  - [`direction`: Declare the Time of Decoding](#direction-declare-the-time-of-decoding)
  - [`decoderArg`: Pass Arguments to Decoder](#decoderarg-pass-arguments-to-decoder)
  - [`decoder`: Override the Default Decoder](#decoder-override-the-default-decoder)
  - [`maxItems` and `maxDepth`: Limit Large and Nested Values](#maxitems-and-maxdepth-limit-large-and-nested-values)
- [Decoders for Return Types](#decoders-for-return-types)
  - [Native Return Type Decoders](#native-return-type-decoders)
  - [Java Return Type Decoders](#java-return-type-decoders)

<!-- /TOC -->

## What Are Decoders?

frooky uses decoders to turn the raw arguments and return values captured at a hook into strucutred output. Decoders are used to decode both parameters and return values.

Depending on the type, this can be fairly simple. Primitives, such as Integers, Floats, or Shorts, can always be decoded by the frooky agent. However, some values require more complex decoders — for example when the time of decoding varies, or when more context information is needed to decode a value correctly.

frooky comes with a set of decoders for various use cases. By default, frooky chosses the best fitting decoder for the type. But you can change what decoder is used or its settings.

## How frooky Picks a Decoder

For a Java object, frooky picks the decoder by the object's runtime class, not by the type declared in the hook file. A parameter declared as `java.lang.Object` that receives a `HashMap` is decoded as a map. frooky uses the first of these that applies:

1. **`decoder` in the decoder settings.** A decoder you choose always wins. If it fails on a value, frooky logs a warning and decodes the value as if no `decoder` were set.
2. **A class decoder** for the runtime class or, if there is none, for its nearest superclass. `Intent` has one, so a `LabeledIntent`, a subclass of `Intent`, is decoded like an `Intent`.
3. **An interface decoder** for an interface the class implements, such as `java.util.Map` or `java.lang.Iterable`. If there are several, the most specific one wins: an interface that extends another one, e.g. `java.util.Collection` over `java.lang.Iterable`. If unrelated interfaces remain, e.g. a class that implements both `Map` and `Iterable`, the first one in frooky's list wins (`Map` before `Iterable`) and frooky logs a warning. Set `decoder` to choose another one.
4. **`toString()`** of the object.

Primitives, `java.lang.String` and arrays are decoded by their declared type. With `-v`, frooky logs which decoder it picked for each runtime class and why. See [`04_decoder_resolution.yaml`](examples/android/03_decoders/04_decoder_resolution.yaml).

### Built-in Java Decoders

Class decoders, also used for subclasses:

| Class                                                      | Decoded as                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `android.content.Intent`                                   | Its getters (action, data, extras, ...), flags as `FLAG_*` names                                       |
| `android.os.Bundle`, `android.os.PersistableBundle`        | Key/value pairs                                                                                        |
| `android.content.ContentValues`                            | Column/value pairs                                                                                     |
| `android.content.ClipData`                                 | Description, item count and items                                                                      |
| `android.security.keystore.KeyGenParameterSpec`            | Its `get*()` and `is*()` getters                                                                       |
| `android.content.pm.Signature`                             | The signing certificate, like `X509Certificate`                                                        |
| `android.hardware.biometrics.BiometricPrompt$CryptoObject` | The Cipher, Signature or Mac it wraps                                                                  |
| `androidx.biometric.BiometricPrompt$CryptoObject`          | The same, for the AndroidX Biometric library (not found by name if the app is minified with R8)        |
| `android.location.Location`                                | Provider, coordinates, accuracy, altitude, speed, bearing, time, whether it is mocked                  |
| `java.lang.Enum`                                           | The declared name (`name()`), even if the enum overrides `toString()`                                  |
| `java.nio.ByteBuffer`                                      | Position, limit, capacity, and the bytes between position and limit as hex. The position doesn't move. |
| `java.security.cert.X509Certificate`                       | Subject, issuer, serial number, validity, algorithms, subject alternative names, SHA-256 fingerprint   |
| `java.security.cert.Certificate`                           | Other certificates than X.509: type, public key algorithm, SHA-256 fingerprint                         |
| `javax.crypto.Cipher`                                      | Transformation, and once initialized its mode (`ENCRYPT_MODE`, ...), provider, IV and block size       |
| `javax.crypto.Mac`                                         | Algorithm, and once initialized its provider and MAC length                                            |
| `java.security.Signature`                                  | Algorithm, state (`UNINITIALIZED`, `SIGN`, `VERIFY`) and provider                                      |
| `java.security.MessageDigest`                              | Algorithm, provider and digest length                                                                  |

Interface decoders, in the order that decides between unrelated interfaces:

| Interface                                   | Decoded as                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `java.security.Key`                         | Algorithm, format and the encoded key as hex (`null` for keys of the Android Keystore)      |
| `java.security.spec.KeySpec`                | Its getters, e.g. password, salt and iteration count of a `PBEKeySpec`                      |
| `java.security.spec.AlgorithmParameterSpec` | Its getters, e.g. IV and tag length of a `GCMParameterSpec`                                 |
| `android.webkit.WebResourceRequest`         | URL, method, request headers, and whether it is for the main frame, a redirect or a gesture |
| `java.util.Map`                             | Keys and values                                                                             |
| `java.util.Map$Entry`                       | Key and value                                                                               |
| `java.lang.Iterable`                        | Elements                                                                                    |
| `java.lang.CharSequence`                    | Its text (`toString()`), e.g. of a `StringBuilder`                                          |

The spec decoders show a `byte[]` as hex and a `char[]` as text. `Cipher`, `Mac` and `Signature` choose their provider when they are initialized, depending on the key. Their decoders never make them choose one early, so they show the provider only once it is chosen. See [`05_crypto_types.yaml`](examples/android/03_decoders/05_crypto_types.yaml).

## Decoder Settings

A decoder's behavior is controlled by `decoderSettings`:

| Setting      | Type       | Default     | Description                                                                                                                                                                                               |
| ------------ | ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decoder`    | `string`   | `undefined` | Overrides the type decoder with a registered custom decoder, see [`decoder`](#decoder-override-the-default-decoder).                                                                                      |
| `decoderArg` | `string`   | `undefined` | Name of another parameter passed to this parameter's decoder for additional context (e.g. a buffer's length).                                                                                             |
| `maxDepth`   | `number`   | `10`        | Maximum number of nested levels decoded (arrays, lists, maps, bundles, etc.). Must be at least `1`, see [limits](#maxitems-and-maxdepth-limit-large-and-nested-values).                                   |
| `maxItems`   | `number`   | `100`       | Maximum number of elements decoded per array, list, map, etc., bytes per buffer, or characters per Java string. Must be at least `1`, see [limits](#maxitems-and-maxdepth-limit-large-and-nested-values). |
| `argFilter`  | `string[]` | `undefined` | Regular expressions matched against the decoded argument value (not the parameter's type or name). The event is only captured if the value matches one of them.                                           |

When settings are attached to a parameter or a return type, an additional `direction` field is available, see [`direction`](#direction-declare-the-time-of-decoding).

`decoderSettings` can be declared at multiple levels of a hook file (file-level, hook collection, individual hook, or per-parameter/return-type). See [Settings Precedence](./additional-features.md#settings-precedence) for how these levels combine. The following chapters explain the settings that need more context through practical examples.

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

For some types, frooky's built-in decoders are not sufficient to give the captured value meaningful context (for example, a bitmask `int` where the individual flags matter more than the raw number). In these cases, you can select one of frooky's registered custom decoders by name using `decoder`. It wins over the decoder frooky would pick for the value (see [How frooky Picks a Decoder](#how-frooky-picks-a-decoder)).

> [!NOTE]
> The currently registered decoders for Java hooks are:
>
> - `string`: decodes a `byte[]` or `char[]` as text, or calls `toString()` on any other reference type
> - `getters`: decodes an object through its public `get*()` and `is*()` methods, including inherited ones, e.g. an app class without a decoder
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

Native hooks have one registered decoder:

- `string`: decodes a pointer (`void *`, ...) as a UTF-8 string, or as ASCII if the bytes aren't valid UTF-8. Without a `decoderArg`, the string ends at its NUL terminator. With a `decoderArg`, that parameter's value is the buffer length and exactly that many bytes are decoded, so buffers that aren't NUL-terminated can be decoded too. NUL bytes inside the buffer don't end the string; they are decoded like any other byte (as `.` when decoded as ASCII). At most `maxItems` bytes are decoded, and a longer string ends with `...`.

`char *` is always decoded this way, and so is `unsigned char *` without a `decoderArg`, so they don't need `decoder: string`.

[`read`](https://www.man7.org/linux/man-pages/man2/read.2.html) fills `buf` with up to `count` bytes that are not NUL-terminated, so `count` is passed as the length:

```yaml
module: libc.so
hooks:
  - symbol: read
    retType: ssize_t
    params:
      - [int, fd]
      - [void *, buf, { direction: out, decoderArg: count, decoder: string, maxItems: 200 }]
      - [size_t, count]
```

`count` is the size of the buffer, not the number of bytes `read` wrote, which is the return value. Bytes after the data that was read are decoded too, up to `maxItems`.

### `maxItems` and `maxDepth`: Limit Large and Nested Values

Hooks run inside the target app on every call, so frooky bounds how much of a value it decodes.

`maxItems` limits the number of elements decoded from a single array, collection or buffer. Anything beyond it is dropped and a `"[truncated at N]"` marker is appended in its place. For `ContentValues`, whose output is a key/value object, the marker is added as a key with the value `null`. Text and hex end with `...` instead: Java strings and other Java values decoded with their `toString()` (cut after `maxItems` characters), Java byte arrays with the `string` or `hex` decoder, native strings, and native buffers decoded as hex (`void *`, and `unsigned char *` with a `decoderArg`).

The elements of a container are decoded with the same `maxItems`, so `maxItems: 5` on a `List<String>` decodes at most 5 elements and cuts each string after 5 characters. An `argFilter` is matched against the cut value.

`maxDepth` limits how many nested levels are decoded. The hooked value itself is level 1, and each container (array, collection, map, bundle, object decoded through its getters) decodes its elements one level deeper. A container found below `maxDepth` is not expanded; its value is replaced by `"[max depth reached]"`. Leaf values, such as primitives and strings, are always decoded. With `maxDepth: 1`, a `List<List<String>>` shows the outer list, but each inner list is replaced by the marker.

| Decoder                                           | `maxItems` limits                    | Counts as a `maxDepth` level |
| ------------------------------------------------- | ------------------------------------ | ---------------------------- |
| Java arrays (`[I`, `[Ljava.lang.String;`, ...)    | Elements                             | Yes                          |
| `java.lang.Iterable` (lists, sets, ...)           | Elements                             | Yes                          |
| `java.util.Map`                                   | Keys and values                      | Yes                          |
| `android.os.Bundle`                               | Extras, and elements of array extras | Yes, array extras too        |
| `android.content.ContentValues`                   | Key/value pairs                      | Yes                          |
| `android.content.ClipData`                        | Items                                | Yes, and each item           |
| `android.content.Intent`                          | -                                    | Yes                          |
| `android.security.keystore.KeyGenParameterSpec`   | -                                    | Yes                          |
| `getters`, `KeySpec`, `AlgorithmParameterSpec`    | -                                    | Yes                          |
| `java.security.Key`, `Cipher`, `Mac`              | Bytes of the key or IV               | No                           |
| `java.nio.ByteBuffer`                             | Remaining bytes                      | No                           |
| `X509Certificate`                                 | Subject alternative names            | No                           |
| `string` and `hex` (for `[B`), `string` for `[C`  | Bytes or characters                  | No                           |
| `java.lang.String`, other values via `toString()` | Characters                           | No                           |
| Native `char *`, `unsigned char *`, `void *`      | Bytes read from the buffer           | No                           |

```yaml
javaClass: android.content.Intent
hooks:
  - method: putExtras
    overloads:
      - params:
        - [ android.os.Bundle, extras, { maxItems: 20, maxDepth: 2 } ]
```

## Decoders for Return Types

Return values are always decoded once the function or method completes (see [Return Type Declaration](./return-type-declaration.md)). To customize how a return value is decoded, add `decoderSettings` to the `retType`.

### Native Return Type Decoders

Use a `[ type, {decoderSettings} ]` tuple instead of a plain type:

```yaml
module: libc.so
hooks:
  - symbol: getenv
    retType: [ "char *", { maxItems: 256 } ]
    params:
      - [ "char *", name ]
```

This example hooks [`getenv`](https://www.man7.org/linux/man-pages/man3/getenv.3.html) and decodes up to 256 characters of the returned value, instead of the default 100.

### Java Return Type Decoders

In Java, the method signature can be retrieved at runtime, so you never declare the return type itself. If you want to customize how the return value is decoded, add a `retType` object containing only `decoderSettings` to the overload:

```yaml
javaClass: android.content.Intent
hooks:
  - method: getFlags
    overloads:
      - params: []
        retType: { decoder: intentFlag }
```

This example hooks the following method from the [Android Java Library](<https://developer.android.com/reference/android/content/Intent#getFlags()>):

```java
public int getFlags ()
```

`getFlags()` returns a raw bitmask `int`. Instead of reporting the raw number, the return value is decoded using the built-in `intentFlag` decoder which resolves the individual `Intent.FLAG_*` constants set in the bitmask.
