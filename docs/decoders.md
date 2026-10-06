# Decoders

<!-- TOC -->

- [What Are Decoders?](#what-are-decoders)
- [Decoder Settings](#decoder-settings)
  - [`direction`: Declare the Time of Decoding](#direction-declare-the-time-of-decoding)
  - [`decoderArgs`: Pass Values to the Decoder by Role](#decoderargs-pass-values-to-the-decoder-by-role)
    - [Roles of Java Decoders](#roles-of-java-decoders)
    - [Roles of Native Decoders](#roles-of-native-decoders)
  - [`decoder`: Override the Default Decoder](#decoder-override-the-default-decoder)
  - [`maxItems` and `maxDepth`: Limit Large and Nested Values](#maxitems-and-maxdepth-limit-large-and-nested-values)
    - [Limits of Java Decoders](#limits-of-java-decoders)
    - [Limits of Native Decoders](#limits-of-native-decoders)
  - [`argFilter`: Capture Only Matching Values](#argfilter-capture-only-matching-values)
- [Built-in Decoders](#built-in-decoders)
- [Shared Decoders](#shared-decoders)
  - [`string`: Decode Bytes as Text](#string-decode-bytes-as-text)
  - [`base64`: Decode Base64 Text](#base64-decode-base64-text)
  - [`hex`: Decode Bytes and Numbers as Hex](#hex-decode-bytes-and-numbers-as-hex)
  - [`constants` and `bitmask`: Decode Named Constants](#constants-and-bitmask-decode-named-constants)
- [Decoders for Return Types](#decoders-for-return-types)

<!-- /TOC -->

## What Are Decoders?

frooky uses decoders to turn the raw arguments and return values captured at a hook into structured output. Decoders are used to decode both parameters and return values.

Depending on the type, this can be fairly simple. Primitives, such as Integers, Floats, or Shorts, can always be decoded by the frooky agent. However, some values require more complex decoders - for example when the time of decoding varies, or when more context information is needed to decode a value correctly.

frooky comes with a set of decoders for various use cases. By default, frooky chooses the best fitting decoder for the type. But you can change what decoder is used or its settings.

This page covers what applies to every hook: the decoder settings, including the `decoderArgs` roles and limits of each Java and native decoder, and the decoders that both Java and native hooks have (`string`, `base64`, `hex`, `constants` and `bitmask`). How frooky picks a decoder and the decoders of only one platform are described per platform:

- [Decoders for Android Java Hooks](./decoders-java.md)
- [Decoders for Native Hooks](./decoders-native.md)

## Decoder Settings

A decoder's behavior is controlled by `decoderSettings`:

| Setting       | Type       | Default     | Description                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `direction`   | `string`   | `"in"`      | When to decode the value: `"in"` (on call), `"out"` (on return), or `"inout"` (both). Only available on parameters and return types, see [`direction`](#direction-declare-the-time-of-decoding).                                                                                                                                                                                                                                |
| `decoder`     | `string`   | `undefined` | Overrides the type decoder with a registered custom decoder, see [`decoder`](#decoder-override-the-default-decoder).                                                                                                                                                                                                                                                                                                            |
| `decoderArgs` | `object`   | `undefined` | Values the decoder needs, each in a role: `length` or `offset`, e.g. `{ length: len }`. Each value is another parameter, `$ret` or a number. See [`decoderArgs`](#decoderargs-pass-values-to-the-decoder-by-role).                                                                                                                                                                                                              |
| `config`      | `object`   | `undefined` | Options of the decoder selected with `decoder`. For `decoder: constants` and `decoder: bitmask`, `constants` maps names to values, e.g. `{ constants: { O_CREAT: 0x40 } }`; in Java hooks, `class` and `fields` read them from a class instead, e.g. `{ class: javax.crypto.Cipher, fields: "*_MODE" }`. See [`constants` and `bitmask`](#constants-and-bitmask-decode-named-constants). Any other decoder accepts no `config`. |
| `maxDepth`    | `number`   | `10`        | Maximum number of nested levels decoded (arrays, lists, maps, bundles, etc.). Must be at least `1`, see [limits](#maxitems-and-maxdepth-limit-large-and-nested-values).                                                                                                                                                                                                                                                         |
| `maxItems`    | `number`   | `100`       | Maximum number of elements decoded per array, list, map, etc., bytes per buffer, or characters per Java string. Must be at least `1`, see [limits](#maxitems-and-maxdepth-limit-large-and-nested-values).                                                                                                                                                                                                                       |
| `argFilter`   | `string[]` | `undefined` | Regular expressions or numeric comparisons matched against the decoded argument value (not the parameter's type or name). The event is only captured if the value matches one of them, see [`argFilter`](#argfilter-capture-only-matching-values).                                                                                                                                                                                                     |

`maxDepth`, `maxItems` and `decoder` can be declared at multiple levels of a hook file (file-level, hook collection, individual hook, or per-parameter/return-type). `decoderArgs`, `config` and `argFilter` can only be set on a single parameter (`config` also on a return type). On a parameter, decoder settings are attached as the third element of the parameter declaration tuple:

```yaml
params:
  - [ <type>, <name>, { <decoder settings> } ]
```

See [Settings Precedence](./additional-features.md#settings-precedence) for how these levels combine. The following chapters explain the settings that need more context.

### `direction`: Declare the Time of Decoding

By default, arguments are decoded when the function or method is entered (`direction: in`). Larger data structures, such as arrays and memory buffers, are often passed by reference so the function or method can write results into them. In these cases:

- `direction: in` (default): Decode parameter when the function or method is called.
- `direction: out`: Decode parameter after the function returns, capturing data written by the function into output buffers or objects.
- `direction: inout`: Decode parameter both upon entry and upon return, allowing you to observe how the value changed.

**Native output buffer (`direction: out`):**

When calling `read(int fd, void *buf, size_t count)`, `buf` is empty on entry and filled upon return. Using `direction: out` captures the data after `read` returns:

```yaml
module: libc.so
hooks:
  - symbol: read
    retType: ssize_t
    params:
      - [ int, fd ]
      - [ "void *", buf, { direction: out, decoderArgs: { length: $ret }, decoder: string } ]
      - [ size_t, count ]
```

**Java output array (`direction: out`):**

[`MessageDigest.digest(byte[], int, int)`](<https://developer.android.com/reference/java/security/MessageDigest#digest(byte[],%20int,%20int)>) computes the hash and writes it into `buf`, so `buf` must be decoded on return:

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

**Java in-place mutation (`direction: inout`):**

`toggleCase(data: ByteArray)` of the Java target app flips the case of every letter of `data` in place:

```yaml
javaClass: org.owasp.mastestapp.MastgTest
hooks:
  - method: toggleCase
    overloads:
      - params:
          - [ "[B", data, { direction: inout, decoder: string } ]
```

The event records `data` both on entry (`"frooky"` in `argsIn`) and on return (`"FROOKY"` in `argsOut`).

See [`02_output_parameters.yaml` (Java)](examples/android/02_parameters_and_return_values/02_output_parameters.yaml) and [`02_output_parameters.yaml` (native)](examples/native/02_parameters_and_return_values/02_output_parameters.yaml).

### `decoderArgs`: Pass Values to the Decoder by Role

Some values can only be decoded with other values. A buffer that isn't NUL-terminated needs its length, and a Java method that uses only part of a `byte[]` passes where that part starts and how long it is. `decoderArgs` passes these values to the decoder of a parameter. Each value has a **role**, which says what it means:

| Role     | Meaning                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------- |
| `length` | How many elements to decode: bytes of a buffer, elements of an array, characters of a `char[]`. |
| `offset` | How many elements to skip before decoding, e.g. where a slice starts in a Java `byte[]`.        |

A role means the same for every decoder that accepts it. Each decoder accepts some roles, or none; see the roles of [Java](#roles-of-java-decoders) and [native](#roles-of-native-decoders) decoders. A hook whose parameter passes a role its decoder doesn't accept is invalid: frooky skips it and logs which roles the decoder accepts.

The value of a role is one of:

- **The name of another parameter** of the same function or method. That parameter is decoded first, with its own type and settings: a `size_t` as a number, an `int *` as the `int` it points to. For a parameter with `direction: out`, it's decoded on return as well, so it can be a value the function writes.
- **`$ret`, the return value.** Only for a parameter with `direction: out`, since the return value only exists once the call returns. A native hook also needs a `retType`.
- **A number**, e.g. `length: 32` for a key whose length is fixed but not passed.

A value that isn't a non-negative integer when the hook fires, such as `-1` when `read` fails, decodes the parameter as `null`. `decoderArgs` is only supported on parameters, not on the return value.

See [`04_decoder_args.yaml`](examples/android/04_decoder_settings/04_decoder_args.yaml) and [`01_strings_and_buffers.yaml`](examples/native/03_decoders/01_strings_and_buffers.yaml).

#### Roles of Java Decoders

Java can't pass a pointer into the middle of an array, so many APIs take an array with an offset and a length and only use that slice. Java decoders accept these roles:

| Decoder of the parameter                                      | Role `offset`               | Role `length`                          |
| ------------------------------------------------------------- | --------------------------- | -------------------------------------- |
| Arrays (`[B`, `[C`, `[I`, `[Ljava.lang.String;`, ...)         | Elements to skip            | Elements to decode                     |
| `decoder: string` on `[B` or `[C`                             | Bytes or characters to skip | Bytes or characters to decode as text  |
| `decoder: base64` on `[B` or `[C`                             | Bytes or characters to skip | Bytes or characters of the base64 text |
| `decoder: hex` on an array of numbers (`[B`, `[I`, `[D`, ...) | Elements to skip            | Elements to decode as hex              |
| All other types and decoders                                  | –                           | –                                      |

Without `offset`, the slice starts at index 0. Without `length`, it ends at the end of the array. A slice that reaches past the end of the array is cut to the array. At most `maxItems` elements of the slice are decoded. A role on any other parameter, e.g. on a `java.lang.String` or with `decoder: getters`, makes the hook invalid.

[`SecretKeySpec(byte[] key, int offset, int len, String algorithm)`](<https://developer.android.com/reference/javax/crypto/spec/SecretKeySpec#SecretKeySpec(byte[],%20int,%20int,%20java.lang.String)>) takes the key from the middle of a larger buffer. With the roles `offset` and `length`, only the key is decoded, not the whole buffer:

```yaml
javaClass: javax.crypto.spec.SecretKeySpec
hooks:
  - method: $init
    overloads:
      - params:
        - [ "[B", key, { decoderArgs: { offset: offset, length: len } } ]
        - [ int, offset ]
        - [ int, len ]
        - [ java.lang.String, algorithm ]
```

Common APIs that pass a slice:

| API                                                                                   | Parameter | `decoderArgs`                               |
| ------------------------------------------------------------------------------------- | --------- | ------------------------------------------- |
| `SecretKeySpec(byte[] key, int offset, int len, String algorithm)`                    | `key`     | `{ offset: offset, length: len }`           |
| `IvParameterSpec(byte[] iv, int offset, int len)`                                     | `iv`      | `{ offset: offset, length: len }`           |
| `Cipher.update(byte[] input, int inputOffset, int inputLen)`, also `doFinal`          | `input`   | `{ offset: inputOffset, length: inputLen }` |
| `Mac.update(byte[] input, int offset, int len)`, also `MessageDigest` and `Signature` | `input`   | `{ offset: offset, length: len }`           |
| `OutputStream.write(byte[] b, int off, int len)`                                      | `b`       | `{ offset: off, length: len }`              |
| `InputStream.read(byte[] b, int off, int len)`, with `direction: out`                 | `b`       | `{ offset: off, length: $ret }`             |

`read` returns how many bytes it read, so the return value is the length of the slice. Hook the class that implements `read`, e.g. `FileInputStream`, since most streams override it:

```yaml
javaClass: java.io.FileInputStream
hooks:
  - method: read
    overloads:
      - params:
        - [ "[B", b, { direction: out, decoder: string, decoderArgs: { offset: off, length: $ret } } ]
        - [ int, off ]
        - [ int, len ]
```

#### Roles of Native Decoders

Native decoders accept these roles:

| Decoder of the parameter                                                                          | Role `length`                                                                              | Role `offset`                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| `void *`, `unsigned char *`                                                                       | Bytes of the buffer, decoded as hex                                                        | Bytes to skip                    |
| `char *`, and `decoder: string` on any pointer                                                    | Bytes of the string. NUL bytes in it don't end it.                                         | Bytes to skip                    |
| `decoder: base64`                                                                                 | Bytes of the base64 text                                                                   | Bytes to skip                    |
| `decoder: hex` on a pointer                                                                       | Bytes to decode as hex. NUL bytes in it don't end it.                                      | Bytes to skip                    |
| Other pointers (`int *`, `char **`, ...)                                                          | Elements of the array, see [Pointers and Arrays](./decoders-native.md#pointers-and-arrays) | Elements to skip                 |
| `decoder: nullTerminated`                                                                         | –                                                                                          | Elements to skip, e.g. `argv[0]` |
| UTF-16 pointers (`const jchar *`, ...), and `decoder: utf16`                                      | Code units of the string (2 bytes each). 0 units in it don't end it.                       | Code units to skip               |
| Values passed by value, unknown types, and the other decoders (`fd`, `constants`, `bitmask`, ...) | –                                                                                          | –                                |

Without `offset`, decoding starts at the pointer. Without `length`, a `char *` ends at its `\0`, and other pointers are read as one element. C usually passes a slice as a pointer to its start (`buf + off`), so `offset` is only needed for APIs that pass the start and the offset separately.

[`send`](https://www.man7.org/linux/man-pages/man2/send.2.html) passes the length of `buf` as `len`:

```yaml
module: libc.so
hooks:
  - symbol: send
    retType: ssize_t
    params:
      - [int, sockfd]
      - [const void *, buf, { decoderArgs: { length: len }, decoder: string }]
      - [size_t, len]
      - [int, flags]
```

The [`read` example of `direction`](#direction-declare-the-time-of-decoding) passes the return value of `read`, the number of bytes it wrote, in the role `length`.

[`EVP_EncryptUpdate`](https://docs.openssl.org/3.0/man3/EVP_EncryptInit/) of OpenSSL encrypts `inl` bytes of `in` and writes the result into `out`. How many bytes it writes depends on the cipher, and it stores that number in `*outl`:

```c
int EVP_EncryptUpdate(EVP_CIPHER_CTX *ctx,       // Cipher context
                      unsigned char *out,        // Output buffer
                      int *outl,                 // Number of bytes written to out
                      const unsigned char *in,   // Input buffer
                      int inl);                  // Length of the input buffer
```

So `out` and `outl` are decoded on return, and `outl`, read as the `int` it points to, is the length of `out`:

```yaml
module: libcrypto.so
hooks:
  - symbol: EVP_EncryptUpdate
    retType: int
    params:
      - [ "EVP_CIPHER_CTX *", ctx ]
      - [ "unsigned char *", out, { direction: out, decoderArgs: { length: outl } } ]
      - [ "int *", outl, { direction: out } ]
      - [ "const unsigned char *", in, { decoderArgs: { length: inl } } ]
      - [ int, inl ]
```

### `decoder`: Override the Default Decoder

For some types, the decoder frooky picks is not sufficient to give the captured value meaningful context (for example, a bitmask `int` where the individual flags matter more than the raw number). In these cases, you can select one of frooky's built-in decoders by name using `decoder`.

The decoder you choose always wins over the one frooky would pick for the value. The built-in decoders differ per platform, see [Built-in Decoders](#built-in-decoders).

If the decoder can't decode a value:

- **Java hooks**: frooky logs a warning, once per parameter, and decodes the value with the decoder it would pick without `decoder`. For example, `decoder: hex` on a `String` gives the string, and `decoder: base64` on a `String` that isn't base64 gives the string.
- **Native hooks**: there is no fallback. A NULL pointer, or a value in `decoderArgs` that isn't a non-negative integer, is decoded as `null`. Only `base64` falls back: text that isn't base64 is decoded like with `string`.

A hook only accepts the decoders of its platform; frooky skips a hook with a decoder of the other platform, e.g. `decoder: fd` in a Java hook, with a warning that lists the valid names. The [JSON schema](./schema/frooky-config.schema.json) offers the names for autocompletion: the Java decoders below `javaClass`, the native decoders below `module`, and both in the top-level `settings`.

### `maxItems` and `maxDepth`: Limit Large and Nested Values

Hooks run inside the target app on every call, so frooky bounds how much of a value it decodes.

`maxItems` limits the number of elements decoded from a single array, collection or buffer. Anything beyond it is dropped and a `"[truncated at N]"` marker is appended in its place. Text and hex end with `...` instead.

The elements of a container are decoded with the same `maxItems`, so `maxItems: 5` on a `List<String>` decodes at most 5 elements and cuts each string after 5 characters. An `argFilter` is matched against the cut value.

`maxDepth` limits how many nested levels are decoded. The hooked value itself is level 1, and each container (array, collection, map, bundle, object decoded through its getters) decodes its elements one level deeper. A container found below `maxDepth` is not expanded; its value is replaced by `"[max depth reached]"`. Leaf values, such as primitives and strings, are always decoded. With `maxDepth: 1`, a `List<List<String>>` shows the outer list, but each inner list is replaced by the marker.

What each decoder counts is listed for [Java](#limits-of-java-decoders) and [native](#limits-of-native-decoders) decoders below. For `string`, `base64` and `hex`, see their chapters in [Shared Decoders](#shared-decoders).

#### Limits of Java Decoders

What `maxItems` limits for each Java decoder, and whether it counts as a `maxDepth` level:

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
| `java.lang.String`, other values via `toString()` | Characters                           | No                           |

For `ContentValues`, whose output is a key/value object, the `"[truncated at N]"` marker is added as a key with the value `null`. Java strings and other values decoded with their `toString()` end with `...` when they're cut.

```yaml
javaClass: android.content.Intent
hooks:
  - method: putExtras
    overloads:
      - params:
        - [ android.os.Bundle, extras, { maxItems: 20, maxDepth: 2 } ]
```

#### Limits of Native Decoders

What `maxItems` limits for each native decoder. Native decoders don't nest, so `maxDepth` doesn't apply.

| Decoder                               | `maxItems` limits          |
| ------------------------------------- | -------------------------- |
| `char *`, `unsigned char *`, `void *` | Bytes read from the buffer |
| Other pointers with the role `length` | Elements of the array      |
| `nullTerminated`                      | Elements of the array      |
| UTF-16 pointers, `utf16`              | Code units of the string   |

Strings and buffers decoded as hex end with `...` when they're cut, arrays end with a `"[truncated at N]"` marker.

### `argFilter`: Capture Only Matching Values

`argFilter` is a list of regular expressions or numeric comparisons (`>`, `>=`, `<`, `<=`, `==`, `!=`). An event is only captured if the decoded value of the parameter matches one of them:

- **Numeric comparisons**: A filter starting with a comparison operator and a number (e.g. `"> 100"`, `"<= 0"`, `"-1"` or `"!= 0"`) compares numerically against decoded numbers or decimal numeric strings (such as 64-bit integers decoded as text). Non-numeric strings or other types do not match numeric comparisons.
- **Regular expressions**: Any other filter is treated as a regular expression and matched against the value's string representation.

An object matches if one of its string or number fields matches, e.g. the `path` or `fd` of a file descriptor decoded with `decoder: fd`. A value decoded with its runtime type, e.g. a `String` passed as a `java.lang.Object` parameter, is matched by its inner value. Lists, booleans and `null` always pass. Several hooks on the same function or method each apply their own filters.

```yaml
# Regex filter: only record events with specific name prefixes
javaClass: org.owasp.mastestapp.MastgTest
hooks:
  - method: trackEvent
    overloads:
      - params:
          - [java.lang.String, name, { argFilter: ["^button_"] }]

# Numeric comparison: only collect connections to well-known ports (<= 1024)
javaClass: java.net.Socket
hooks:
  - method: $init
    overloads:
      - params:
          - [java.lang.String, host]
          - [int, port, { argFilter: ["<=1024"] }]
```

## Built-in Decoders

These decoders can be selected with `decoder`, on a parameter and on a return value (see [Decoders for Return Types](#decoders-for-return-types)). `errno` only works on a return value.

| Decoder                                                               | Java | Native | Description                                                               |
| --------------------------------------------------------------------- | ---- | ------ | ------------------------------------------------------------------------- |
| [`string`](#string-decode-bytes-as-text)                              | ✓    | ✓      | Bytes as text                                                             |
| [`base64`](#base64-decode-base64-text)                                | ✓    | ✓      | Base64 text as the bytes it encodes                                       |
| [`hex`](#hex-decode-bytes-and-numbers-as-hex)                         | ✓    | ✓      | Bytes or a number as hex                                                  |
| [`constants`](#constants-and-bitmask-decode-named-constants)          | ✓    | ✓      | An integer as the name of its constant                                    |
| [`bitmask`](#constants-and-bitmask-decode-named-constants)            | ✓    | ✓      | An integer as the names of the constants whose bits are set               |
| [`getters`](./decoders-java.md#getters)                               | ✓    |        | An object through its public `get*()` and `is*()` methods                 |
| [`hashCode`](./decoders-java.md#hashcode)                             | ✓    |        | An object as `<class>@<identity hash code>`, the `hashCode` of its events |
| [`utf16`](./decoders-native.md#utf-16-strings)                        |      | ✓      | A pointer as a UTF-16 string                                              |
| [`nullTerminated`](./decoders-native.md#pointers-and-arrays)          |      | ✓      | A pointer to pointers as an array that ends at a NULL pointer             |
| [`fd`](./decoders-native.md#file-descriptors)                         |      | ✓      | An `int` file descriptor as the file, socket or pipe it refers to         |
| [`errno`](./decoders-native.md#errno)                                 |      | ✓      | On the return value, adds the `errno` of a call that failed               |
| [`openFlags`, `mmapProt`, ...](./decoders-native.md#constant-presets) |      | ✓      | `constants` and `bitmask` with the constants of system calls built in     |

## Shared Decoders

### `string`: Decode Bytes as Text

`decoder: string` decodes bytes as text: as UTF-8, or as ASCII if the bytes aren't valid UTF-8.

**In Java hooks**, it decodes a `byte[]` or a `char[]` as text, which are otherwise lists of numbers or characters. It calls `toString()` on any other reference type. `decoderArgs` can select a slice of a `[B` or `[C` (see [roles of Java decoders](#roles-of-java-decoders)).

```yaml
javaClass: org.owasp.mastestapp.MastgTest
hooks:
  - method: receiveTextBytes
    overloads:
      - params:
          - ["[B", text, { decoder: string }]
```

This decodes `text` as `"Hello frooky"` instead of `[72, 101, 108, ...]`.

**In native hooks**, it decodes the memory a pointer (`void *`, ...) points to. Without the role `length`, the string ends at its NUL terminator. With it, NUL bytes inside the buffer don't end the string; they are decoded like any other byte (as `.` when decoded as ASCII). `char *` is always decoded this way, and so is `unsigned char *` without the role `length`, so they don't need `decoder: string`. See [roles of native decoders](#roles-of-native-decoders).

```yaml
module: libreceiveFundamentalReference.so
hooks:
  - symbol: send_message
    params:
      - ["void *", buf, { decoderArgs: { length: len }, decoder: string }]
      - [int, len]
```

This decodes `buf` as `"Hello frooky"` instead of `"0x48656c6c6f2066726f6f6b79"`.

At most `maxItems` bytes or characters are decoded, and a longer string ends with `...`. See [`03_custom_decoders.yaml`](examples/android/03_decoders/03_custom_decoders.yaml) and [`01_strings_and_buffers.yaml`](examples/native/03_decoders/01_strings_and_buffers.yaml).

### `base64`: Decode Base64 Text

`decoder: base64` Base64-decodes a value. Standard and URL-safe base64 are decoded, with or without padding, and whitespace such as line breaks is ignored. The decoded bytes are shown as text if they're printable UTF-8 text, otherwise as hex, e.g. a key.

**In Java hooks**, it decodes a `String`, a `byte[]` or `char[]` of base64 text, or the `toString()` of any other value. `decoderArgs` can select a slice of a `[B` or `[C`. A value that isn't base64 is decoded as if no `decoder` were set.

```yaml
javaClass: org.owasp.mastestapp.MastgTest
hooks:
  - method: receiveBase64
    overloads:
      - params:
          - [java.lang.String, encoded, { decoder: base64 }]
```

This decodes `"SGVsbG8gZnJvb2t5"` as `"Hello frooky"`, and the base64 of the bytes `0x00` to `0x0f` as `"0x000102030405060708090a0b0c0d0e0f"`.

**In native hooks**, it decodes the string a pointer points to, which ends at its NUL terminator unless the role `length` gives its length. Text that isn't base64 is decoded like with `string`, and frooky logs a warning. Base64 text in a buffer usually has a length, e.g. the input of OpenSSL's [`EVP_DecodeBlock`](https://docs.openssl.org/3.0/man3/EVP_EncodeInit/):

```yaml
module: libreceiveString.so
hooks:
  - symbol: receive_base64
    params:
      - ["const char *", encoded, { decoder: base64, decoderArgs: { length: len } }]
      - [int, len]
```

This decodes the first 16 bytes of `"SGVsbG8gZnJvb2t5|trailer"` as `"Hello frooky"`, and `"AAECAwQFBgcICQoLDA0ODw=="` as `"0x000102030405060708090a0b0c0d0e0f"`.

At most `maxItems` decoded bytes are shown, and longer output ends with `...`. See [`03_custom_decoders.yaml`](examples/android/03_decoders/03_custom_decoders.yaml) and [`01_strings_and_buffers.yaml`](examples/native/03_decoders/01_strings_and_buffers.yaml).

### `hex`: Decode Bytes and Numbers as Hex

`decoder: hex` decodes a value as hexadecimal, e.g. `"0x48656c6c6f"`. A number is shown with the bits of its type: `-1` is `"0xffffffff"` as an `int` and `"0xff"` as a `byte`, and a `float` or `double` is shown as its IEEE 754 bits, e.g. `1.5` as a `float` is `"0x3fc00000"`.

**In Java hooks**, it decodes a `byte[]` as one hex string, which is otherwise a list of numbers, a number (`byte`, `short`, `char`, `int`, `long`, `float`, `double`) as hex, and an array of other numbers (`short[]`, `char[]`, `int[]`, `long[]`, `float[]`, `double[]`) as a list of them in hex, e.g. `["0x48", "0xffffffff"]`. `decoderArgs` can select a slice of an array. Any other value is decoded as if no `decoder` were set.

```yaml
javaClass: org.owasp.mastestapp.MastgTest
hooks:
  - method: receiveByteArray
    overloads:
      - params:
          - ["[B", bytes, { decoder: hex }]
```

This decodes `bytes` as `"0x010203"` instead of `[1, 2, 3]`.

**In native hooks**, it decodes the bytes a pointer points to as one hex string, also for a `char *`, which is otherwise decoded as text. Without the role `length`, the bytes end at a NUL byte, so binary data needs its length. A number passed by value is decoded as hex, also a `float` or `double` return value; a type frooky doesn't know, e.g. `mode_t`, is read as 32 bits.

```yaml
module: libreceiveFundamentalValue.so
hooks:
  - symbol: receive_int
    params:
      - [int, minValue, { decoder: hex }]
      - [int, maxValue, { decoder: hex }]
```

This decodes `INT_MIN` and `INT_MAX` as `"0x80000000"` and `"0x7fffffff"`. On `receive_double`, `-DBL_MAX` is `"0xffefffffffffffff"`.

At most `maxItems` bytes or array elements are decoded. A cut hex string ends with `...`, a cut list with a `"[truncated at N]"` marker. See [`03_custom_decoders.yaml`](examples/android/03_decoders/03_custom_decoders.yaml), [`01_strings_and_buffers.yaml`](examples/native/03_decoders/01_strings_and_buffers.yaml) and [`04_constants_and_bitmasks.yaml`](examples/native/03_decoders/04_constants_and_bitmasks.yaml).

### `constants` and `bitmask`: Decode Named Constants

Many APIs take an integer that stands for one or more named constants, e.g. the `opmode` of `Cipher.init()`, the `flags` of `Intent.setFlags()` or the `flags` of `open`. Such an integer is decoded to the names of its constants:

- `decoder: constants`: the name of the constant with exactly this value, e.g. `"LOG_LEVEL_WARN"`. A value without a constant is decoded as the value itself.
- `decoder: bitmask`: the names of the constants whose bits are set, as a list, e.g. `["PERMISSION_READ", "PERMISSION_SHARE"]`. Bits that no constant has are added as one hex string, e.g. `"0x100"`. A constant with the value `0` is only shown if no bit is set, and a constant with several bits wins over the constants it includes.

`config` is only accepted by `constants` and `bitmask`; on a value with any other decoder, frooky skips the hook with a warning.

The constants are numbers, so only numeric values can be decoded:

- **Native hooks**: integers passed by value, e.g. `int`, `unsigned long` or `uint32_t`. A pointer, e.g. `int *`, isn't followed, so its address is decoded. `float` and `double` aren't supported.
- **Java hooks**: values of a primitive type. A map in `config: { constants }` matches `int`, `long`, `short`, `byte`, `float` and `double` values. The constants of a class are its fields of the type of the value, so a `boolean` or `char` value can be decoded too. Fields of other types, e.g. `String` constants such as `KeyProperties.KEY_ALGORITHM_AES`, are never matched. `bitmask` only decodes `int`, `long`, `short`, `byte` and `char` values.

#### A Map of Constants

`config: { constants }` maps the names to their values. YAML reads `0x40` as a number, so hex values can be written as they are in C headers:

```yaml
module: libreceiveFundamentalValue.so
hooks:
  - symbol: set_permissions
    params:
      - [ unsigned int, permissions, { decoder: bitmask, config: { constants: { PERMISSION_READ: 0x1, PERMISSION_WRITE: 0x2, PERMISSION_SHARE: 0x4 } } } ]
```

Java hooks can also read the constants from a class (see [below](#java-hooks-the-constants-of-a-class)). A map helps when no class declares them, or the app is obfuscated and its fields have no meaningful names:

```yaml
javaClass: org.owasp.mastestapp.MastgTest
hooks:
  - method: receiveMode
    overloads:
      - params:
        - [int, opmode, { decoder: constants, config: { constants: { ENCRYPT: 1, DECRYPT: 2 } } }]
```

`receiveMode(MODE_DECRYPT)` is decoded as `"DECRYPT"`, the name from the map, not the class's own `MODE_DECRYPT`.

**In Java hooks**, an `int` is compared as 32 bits, so a constant can be written in hex, e.g. `0x80000000` for `-2147483648`.

**In native hooks**, the value is read with the size of its declared type, e.g. 32 bits for `int` and `unsigned int`. A type frooky doesn't know, e.g. `mode_t`, is read as 32 bits, the size of a C enum. For the flags and constants of system calls, frooky has [presets](./decoders-native.md#constant-presets) with the constants built in.

#### Java Hooks: The Constants of a Class

In Java hooks, `constants` and `bitmask` can also take their constants from the `static final` fields of a class, set with `config`:

| `config`                      | Constants                                                       |
| ----------------------------- | --------------------------------------------------------------- |
| none                          | the `static final` fields of the hooked class                   |
| `fields: "*_MODE"`            | the `static final` fields of the hooked class whose names match |
| `class: <class>` (+ `fields`) | the `static final` fields of that class (whose names match)     |
| `constants: { NAME: value }`  | the map; it can't be combined with `class` or `fields`          |

Only fields of the type of the value are used, e.g. the `int` fields for an `int` parameter. In `fields`, `*` matches any characters.

**The constants of the hooked class.** `Cipher.init()` takes one of `Cipher`'s own constants:

```yaml
javaClass: javax.crypto.Cipher
hooks:
  - method: init
    overloads:
      - params:
        - [int, opmode, { decoder: constants, config: { fields: "*_MODE" } }]
        - [java.security.Key, key]
```

This decodes the `opmode` argument of [`Cipher.init(int, Key)`](<https://developer.android.com/reference/javax/crypto/Cipher#init(int,%20java.security.Key)>) to `"ENCRYPT_MODE"`, `"DECRYPT_MODE"`, etc. `fields` matters here: `Cipher` also declares `PUBLIC_KEY`, which is `1` like `ENCRYPT_MODE`, so without it `opmode` may be decoded as `"PUBLIC_KEY"`. A class without such duplicates needs no `config` at all, e.g. `{ decoder: constants }`.

The same works for a bitmask. The flags of [`Intent.setFlags(int)`](<https://developer.android.com/reference/android/content/Intent#setFlags(int)>) are `Intent`'s own `FLAG_*` constants:

```yaml
javaClass: android.content.Intent
hooks:
  - method: setFlags
    overloads:
      - params:
        - [int, flags, { decoder: bitmask, config: { fields: "FLAG_*" } }]
```

`Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK` is decoded as `["FLAG_ACTIVITY_NEW_TASK", "FLAG_ACTIVITY_CLEAR_TASK"]`. Where several constants have the same bits, e.g. `FLAG_ACTIVITY_NO_HISTORY` and `FLAG_RECEIVER_REGISTERED_ONLY`, the first one of the class is shown; a narrower pattern such as `FLAG_ACTIVITY_*` picks the right one.

**The constants of another class.** The purposes of a Keystore key are `KeyProperties.PURPOSE_*` constants, but the hooked method is on `KeyGenParameterSpec.Builder`:

```yaml
javaClass: android.security.keystore.KeyGenParameterSpec$Builder
hooks:
  - method: $init
    overloads:
      - params:
        - [java.lang.String, keystoreAlias]
        - [int, purposes, { decoder: bitmask, config: { class: android.security.keystore.KeyProperties, fields: "PURPOSE_*" } }]
```

`KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY` is decoded as `["PURPOSE_SIGN", "PURPOSE_VERIFY"]`. The same helps for an app's own wrapper around an API, e.g. `{ class: javax.crypto.Cipher, fields: "*_MODE" }` on a wrapper method's parameter that takes a `Cipher` mode.

frooky looks the class up when it installs the hook: in the app's default class loader, or else in the class loader of the hooked class, e.g. for a class of a dex the app loads itself. If the class isn't found or has no matching field of the type of the value, frooky logs a warning and decodes the value as it is.

Other common bitmasks: the `flags` of `PendingIntent.getActivity()` (`{ fields: "FLAG_*" }` on `PendingIntent`), of `Context.registerReceiver()` (`{ class: android.content.Context, fields: "RECEIVER_*" }`) and of `Window.setFlags()` (`{ class: android.view.WindowManager$LayoutParams, fields: "FLAG_*" }`).

See [`03_custom_decoders.yaml`](examples/android/03_decoders/03_custom_decoders.yaml) and [`04_constants_and_bitmasks.yaml`](examples/native/03_decoders/04_constants_and_bitmasks.yaml).

## Decoders for Return Types

Return values are always decoded once the function or method completes (see [Return Type Declaration](./return-type-declaration.md)). To customize how a return value is decoded, add decoder settings to the `retType`: [Java](./decoders-java.md#return-values), [native](./decoders-native.md#return-values). Every [built-in decoder](#built-in-decoders) works on a return value, e.g. `base64`:

```yaml
javaClass: org.owasp.mastestapp.MastgTest
hooks:
  - method: receiveBase64
    overloads:
      - params:
          - [java.lang.String, encoded]
        retType: { decoder: base64 }
```

`decoderArgs` is only supported on parameters, so a buffer that a native function returns can't get a length.
