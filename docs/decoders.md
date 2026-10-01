# Decoders

<!-- TOC -->

- [What Are Decoders?](#what-are-decoders)
- [Decoder Settings](#decoder-settings)
  - [`direction`: Declare the Time of Decoding](#direction-declare-the-time-of-decoding)
  - [`decoderArg`: Pass Arguments to Decoder](#decoderarg-pass-arguments-to-decoder)
  - [`decoder`: Override the Default Decoder](#decoder-override-the-default-decoder)
  - [`maxItems` and `maxDepth`: Limit Large and Nested Values](#maxitems-and-maxdepth-limit-large-and-nested-values)
  - [`argFilter`: Capture Only Matching Values](#argfilter-capture-only-matching-values)
- [Decoders for Return Types](#decoders-for-return-types)

<!-- /TOC -->

## What Are Decoders?

frooky uses decoders to turn the raw arguments and return values captured at a hook into structured output. Decoders are used to decode both parameters and return values.

Depending on the type, this can be fairly simple. Primitives, such as Integers, Floats, or Shorts, can always be decoded by the frooky agent. However, some values require more complex decoders — for example when the time of decoding varies, or when more context information is needed to decode a value correctly.

frooky comes with a set of decoders for various use cases. By default, frooky chooses the best fitting decoder for the type. But you can change what decoder is used or its settings.

This page covers what applies to every hook. How frooky picks a decoder, which decoders exist and how they use the settings differs per platform:

- [Decoders for Android Java Hooks](./decoders-java.md)
- [Decoders for Native Hooks](./decoders-native.md)

## Decoder Settings

A decoder's behavior is controlled by `decoderSettings`:

| Setting      | Type       | Default     | Description                                                                                                                                                                                                                                    |
| ------------ | ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decoder`    | `string`   | `undefined` | Overrides the type decoder with a registered custom decoder, see [`decoder`](#decoder-override-the-default-decoder).                                                                                                                           |
| `decoderArg` | `string`   | `undefined` | Name of another parameter, or `$ret` for the return value, whose value the decoder needs, e.g. a buffer length. See [`decoderArg`](#decoderarg-pass-arguments-to-decoder).                                                                     |
| `constants`  | `object`   | `undefined` | Names of the values of an integer, e.g. `{ O_CREAT: 0x40 }`. For `decoder: enum` and `decoder: flags` of [native hooks](./decoders-native.md#flags-and-enums), and for `decoder: constant` of [Java hooks](./decoders-java.md#named-decoders). |
| `maxDepth`   | `number`   | `10`        | Maximum number of nested levels decoded (arrays, lists, maps, bundles, etc.). Must be at least `1`, see [limits](#maxitems-and-maxdepth-limit-large-and-nested-values).                                                                        |
| `maxItems`   | `number`   | `100`       | Maximum number of elements decoded per array, list, map, etc., bytes per buffer, or characters per Java string. Must be at least `1`, see [limits](#maxitems-and-maxdepth-limit-large-and-nested-values).                                      |
| `argFilter`  | `string[]` | `undefined` | Regular expressions matched against the decoded argument value (not the parameter's type or name). The event is only captured if the value matches one of them, see [`argFilter`](#argfilter-capture-only-matching-values).                    |

When settings are attached to a parameter or a return type, an additional `direction` field is available, see [`direction`](#direction-declare-the-time-of-decoding).

`decoderSettings` can be declared at multiple levels of a hook file (file-level, hook collection, individual hook, or per-parameter/return-type). See [Settings Precedence](./additional-features.md#settings-precedence) for how these levels combine. The following chapters explain the settings that need more context.

### `direction`: Declare the Time of Decoding

By default, arguments are decoded when the function or method is called. Larger data structures, such as arrays, are often passed by reference so the function or method can write a result into them. In these cases, decode the parameter after completion using `direction: out`, or both at the beginning and after completion using `direction: inout`.

Examples: [Java](./decoders-java.md#direction-output-parameters), [native](./decoders-native.md#direction-output-parameters).

### `decoderArg`: Pass Arguments to Decoder

Some values can only be decoded with a second value. For example, a buffer that isn't NUL-terminated needs its length. `decoderArg` names that value, which is one of:

- **Another parameter** of the same function or method, by its name.
- **`$ret`, the return value.** Only for a parameter with `direction: out`, since the return value only exists once the call returns. A native hook also needs a `retType`, to decode the return value.

The rules:

- `decoderArg` is exactly one value, and it can't be the parameter itself.
- That value is decoded first, with its own type and settings: a `size_t` as a number, an `int *` as the `int` it points to. For a parameter with `direction: out`, it's decoded on return as well, so it can be a value the function writes.
- The decoder of the parameter decides what the value means, e.g. a length in bytes or a number of elements. Decoders that need no second value ignore it. Native decoders use it, see [`decoderArg` for native hooks](./decoders-native.md#decoderarg-lengths-and-counts). Java decoders ignore it.

### `decoder`: Override the Default Decoder

For some types, frooky's built-in decoders are not sufficient to give the captured value meaningful context (for example, a bitmask `int` where the individual flags matter more than the raw number). In these cases, you can select one of frooky's registered decoders by name using `decoder`.

The decoder you choose always wins over the one frooky would pick for the value. The registered decoders differ per platform: [Java](./decoders-java.md#named-decoders), [native](./decoders-native.md#named-decoders).

### `maxItems` and `maxDepth`: Limit Large and Nested Values

Hooks run inside the target app on every call, so frooky bounds how much of a value it decodes.

`maxItems` limits the number of elements decoded from a single array, collection or buffer. Anything beyond it is dropped and a `"[truncated at N]"` marker is appended in its place. Text and hex end with `...` instead.

The elements of a container are decoded with the same `maxItems`, so `maxItems: 5` on a `List<String>` decodes at most 5 elements and cuts each string after 5 characters. An `argFilter` is matched against the cut value.

`maxDepth` limits how many nested levels are decoded. The hooked value itself is level 1, and each container (array, collection, map, bundle, object decoded through its getters) decodes its elements one level deeper. A container found below `maxDepth` is not expanded; its value is replaced by `"[max depth reached]"`. Leaf values, such as primitives and strings, are always decoded. With `maxDepth: 1`, a `List<List<String>>` shows the outer list, but each inner list is replaced by the marker.

What each decoder counts: [Java](./decoders-java.md#limits), [native](./decoders-native.md#limits).

### `argFilter`: Capture Only Matching Values

`argFilter` is a list of regular expressions. An event is only captured if the decoded value of the parameter matches one of them. Only string and number values are filtered; other values, such as lists, always pass. Several hooks on the same function or method each apply their own filters.

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
