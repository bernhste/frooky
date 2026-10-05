# Decoders

<!-- TOC -->

- [What Are Decoders?](#what-are-decoders)
- [Decoder Settings](#decoder-settings)
  - [`direction`: Declare the Time of Decoding](#direction-declare-the-time-of-decoding)
  - [`decoderArgs`: Pass Values to the Decoder by Role](#decoderargs-pass-values-to-the-decoder-by-role)
  - [`decoder`: Override the Default Decoder](#decoder-override-the-default-decoder)
  - [`maxItems` and `maxDepth`: Limit Large and Nested Values](#maxitems-and-maxdepth-limit-large-and-nested-values)
  - [`argFilter`: Capture Only Matching Values](#argfilter-capture-only-matching-values)
- [Decoders for Return Types](#decoders-for-return-types)

<!-- /TOC -->

## What Are Decoders?

frooky uses decoders to turn the raw arguments and return values captured at a hook into structured output. Decoders are used to decode both parameters and return values.

Depending on the type, this can be fairly simple. Primitives, such as Integers, Floats, or Shorts, can always be decoded by the frooky agent. However, some values require more complex decoders - for example when the time of decoding varies, or when more context information is needed to decode a value correctly.

frooky comes with a set of decoders for various use cases. By default, frooky chooses the best fitting decoder for the type. But you can change what decoder is used or its settings.

This page covers what applies to every hook. How frooky picks a decoder, which decoders exist and how they use the settings differs per platform:

- [Decoders for Android Java Hooks](./decoders-java.md)
- [Decoders for Native Hooks](./decoders-native.md)

## Decoder Settings

A decoder's behavior is controlled by `decoderSettings`:

| Setting       | Type       | Default     | Description                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | ---------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `direction`   | `string`   | `"in"`      | When to decode the value: `"in"` (on call), `"out"` (on return), or `"inout"` (both). Only available on parameters and return types, see [`direction`](#direction-declare-the-time-of-decoding).                                                                                                                                                                                                                                 |
| `decoder`     | `string`   | `undefined` | Overrides the type decoder with a registered custom decoder, see [`decoder`](#decoder-override-the-default-decoder).                                                                                                                                                                                                                                                                                                             |
| `decoderArgs` | `object`   | `undefined` | Values the decoder needs, each in a role: `length` or `offset`, e.g. `{ length: len }`. Each value is another parameter, `$ret` or a number. See [`decoderArgs`](#decoderargs-pass-values-to-the-decoder-by-role).                                                                                                                                                                                                               |
| `config`      | `object`   | `undefined` | Options of the decoder selected with `decoder`. `constants` names the values of an integer for `decoder: constants` and `decoder: bitmask`: a map, e.g. `{ constants: { O_CREAT: 0x40 } }`, or in [Java hooks](./decoders-java.md#named-decoders) also a class, e.g. `{ constants: "javax.crypto.Cipher#*_MODE" }`. See also [native hooks](./decoders-native.md#constants-and-bitmasks). Any other decoder accepts no `config`. |
| `maxDepth`    | `number`   | `10`        | Maximum number of nested levels decoded (arrays, lists, maps, bundles, etc.). Must be at least `1`, see [limits](#maxitems-and-maxdepth-limit-large-and-nested-values).                                                                                                                                                                                                                                                          |
| `maxItems`    | `number`   | `100`       | Maximum number of elements decoded per array, list, map, etc., bytes per buffer, or characters per Java string. Must be at least `1`, see [limits](#maxitems-and-maxdepth-limit-large-and-nested-values).                                                                                                                                                                                                                        |
| `argFilter`   | `string[]` | `undefined` | Regular expressions matched against the decoded argument value (not the parameter's type or name). The event is only captured if the value matches one of them, see [`argFilter`](#argfilter-capture-only-matching-values).                                                                                                                                                                                                      |

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

**Native Output Buffer Example (`direction: out`):**

When calling `read(int fd, void *buf, size_t count)`, `buf` is empty on entry and filled upon return. Using `direction: out` captures the data after `read` returns:

```yaml
module: libc.so
hooks:
  - symbol: read
    retType: ssize_t
    params:
      - [ int, fd ]
      - [ "void *", buf, { direction: out, decoderArgs: { length: $ret } } ]
      - [ size_t, count ]
```

**Java In-Place Mutation Example (`direction: inout`):**

When a method mutates a byte array or collection in place:

```yaml
javaClass: com.example.CryptoHelper
hooks:
  - method: decryptInPlace
    overloads:
      - params:
          - [ "[B", buffer, { direction: inout } ]
```

The resulting event records both the input value and the output value after decryption.

For platform-specific details and further examples, see [Java output parameters](./decoders-java.md#direction-output-parameters) and [native output parameters](./decoders-native.md#direction-output-parameters).

### `decoderArgs`: Pass Values to the Decoder by Role

Some values can only be decoded with other values. A buffer that isn't NUL-terminated needs its length, and a Java method that uses only part of a `byte[]` passes where that part starts and how long it is. `decoderArgs` passes these values to the decoder of a parameter. Each value has a **role**, which says what it means:

| Role     | Meaning                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------- |
| `length` | How many elements to decode: bytes of a buffer, elements of an array, characters of a `char[]`. |
| `offset` | How many elements to skip before decoding, e.g. where a slice starts in a Java `byte[]`.        |

A role means the same for every decoder that accepts it. Each decoder accepts some roles, or none; see the tables for [Java](./decoders-java.md#decoderargs-offset-and-length) and [native](./decoders-native.md#decoderargs-length-and-offset) decoders. A hook whose parameter passes a role its decoder doesn't accept is invalid: frooky skips it and logs which roles the decoder accepts.

The value of a role is one of:

- **The name of another parameter** of the same function or method. That parameter is decoded first, with its own type and settings: a `size_t` as a number, an `int *` as the `int` it points to. For a parameter with `direction: out`, it's decoded on return as well, so it can be a value the function writes.
- **`$ret`, the return value.** Only for a parameter with `direction: out`, since the return value only exists once the call returns. A native hook also needs a `retType`.
- **A number**, e.g. `length: 32` for a key whose length is fixed but not passed.

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

[`read`](https://www.man7.org/linux/man-pages/man2/read.2.html) returns how many bytes it wrote into `buf`, so the return value has the role `length`:

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

A value that isn't a non-negative integer when the hook fires, such as `-1` when `read` fails, decodes the parameter as `null`. `decoderArgs` is only supported on parameters, not on the return value.

See [`04_decoder_args.yaml`](examples/android/04_decoder_settings/04_decoder_args.yaml) and [`01_strings_and_buffers.yaml`](examples/native/03_decoders/01_strings_and_buffers.yaml).

### `decoder`: Override the Default Decoder

For some types, frooky's built-in decoders are not sufficient to give the captured value meaningful context (for example, a bitmask `int` where the individual flags matter more than the raw number). In these cases, you can select one of frooky's registered decoders by name using `decoder`.

The decoder you choose always wins over the one frooky would pick for the value. The registered decoders differ per platform: [Java](./decoders-java.md#named-decoders), [native](./decoders-native.md#named-decoders).

A hook only accepts the decoders of its platform; frooky skips a hook with a decoder of the other platform, e.g. `decoder: fd` in a Java hook, with a warning that lists the valid names. The [JSON schema](./schema/frooky-config.schema.json) offers the names for autocompletion: the Java decoders below `javaClass`, the native decoders below `module`, and both in the top-level `settings`.

### `maxItems` and `maxDepth`: Limit Large and Nested Values

Hooks run inside the target app on every call, so frooky bounds how much of a value it decodes.

`maxItems` limits the number of elements decoded from a single array, collection or buffer. Anything beyond it is dropped and a `"[truncated at N]"` marker is appended in its place. Text and hex end with `...` instead.

The elements of a container are decoded with the same `maxItems`, so `maxItems: 5` on a `List<String>` decodes at most 5 elements and cuts each string after 5 characters. An `argFilter` is matched against the cut value.

`maxDepth` limits how many nested levels are decoded. The hooked value itself is level 1, and each container (array, collection, map, bundle, object decoded through its getters) decodes its elements one level deeper. A container found below `maxDepth` is not expanded; its value is replaced by `"[max depth reached]"`. Leaf values, such as primitives and strings, are always decoded. With `maxDepth: 1`, a `List<List<String>>` shows the outer list, but each inner list is replaced by the marker.

What each decoder counts: [Java](./decoders-java.md#limits), [native](./decoders-native.md#limits).

### `argFilter`: Capture Only Matching Values

`argFilter` is a list of regular expressions. An event is only captured if the decoded value of the parameter matches one of them. String and number values are matched as they are. An object matches if one of its string or number fields matches, e.g. the `path` or `fd` of a file descriptor decoded with `decoder: fd`. A value decoded with its runtime type, e.g. a `String` passed as a `java.lang.Object` parameter, is matched by its inner value. Lists, booleans and `null` always pass. Several hooks on the same function or method each apply their own filters.

```yaml
javaClass: org.owasp.mastestapp.MastgTest
hooks:
  - method: trackEvent
    overloads:
      - params:
        - [java.lang.String, name, { argFilter: ["^button_"] }]
```

## Decoders for Return Types

Return values are always decoded once the function or method completes (see [Return Type Declaration](./return-type-declaration.md)). To customize how a return value is decoded, add decoder settings to the `retType`: [Java](./decoders-java.md#return-values), [native](./decoders-native.md#return-values).
