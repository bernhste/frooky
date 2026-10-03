# `NativeHook` Declaration

This documentation explains how to write native hook declarations.

<!-- TOC -->

- [Structure](#structure)
- [Basic Usage](#basic-usage)
- [Hooking Functions Without a Symbol](#hooking-functions-without-a-symbol)
  - [Finding the Offset](#finding-the-offset)
- [Decoding Arguments and Return Values](#decoding-arguments-and-return-values)
- [Hook and Decoder Settings](#hook-and-decoder-settings)

<!-- /TOC -->

## Structure

A `NativeHook` declaration is a YAML object with these top-level fields:

```yaml
module: <module name>
hookSettings:                       # Optional. Overrides the file-level `settings.hookSettings` for this hook collection
  <hook settings>
decoderSettings:                    # Optional. Overrides the file-level `settings.decoderSettings` for this hook collection
  <decoder settings>
hooks:
  - <symbol name>
  - symbol: <symbol name>             # Or `offset: <offset>`, see below
    retType: <type>                   # Optional
    params:                           # Optional
      - <parameter declaration>
    hookSettings:                     # Optional. Overrides the hook collection's hookSettings for this hook only
      <hook settings>
    decoderSettings:                  # Optional. Overrides the hook collection's decoderSettings for this hook only
      <decoder settings>
```

`module` is the name of the native module, for example a shared library such as `libssl.so`.

`hooks` is a list of native functions to hook. Each item in `hooks` can be written in one of three forms.

Use the **short form** when you only want to hook a symbol and do not need argument or return value decoding.

```yaml
module: <module name>
hooks:
  - <symbol name>
```

Use the **short form with settings** - a `[<symbol name>, {<decoder settings>}]` tuple - to hook a symbol while overriding its `decoderSettings`, without switching to the expanded form.

```yaml
module: <module name>
hooks:
  - [<symbol name>, { <decoder settings> }]
```

Use the **expanded form** when you want frooky to decode arguments and/or the return value.

```yaml
module: <module name>
hooks:
  - symbol: <symbol name>
    retType: <type>                   # Optional
    params:                           # Optional
      - <parameter declaration>
```

In the expanded form:

- `symbol`: Native symbol name.
- `offset`: Instead of `symbol`, the function's offset from the module's base address, for functions without an exported symbol. See [Hooking Functions Without a Symbol](#hooking-functions-without-a-symbol).
- `retType`: Optional return type of the function.
- `params`: Optional list of parameter declarations.

> [!IMPORTANT]
> Read the documentation for [parameter](./parameter-declaration.md) and [return type](./return-type-declaration.md) declarations to learn how to declare and configure them correctly.
>
> There are multiple ways to declare a parameter. In this document, all examples use [named parameters](./parameter-declaration.md#named-native-parameters).

## Basic Usage

The minimum required fields are `module` and `hooks`.

```yaml
module: <module name>
hooks:
  - <symbol name>
```

This hooks the listed symbols from the specified native module.

**Example:**

```yaml
module: libssl.so
hooks:
  - ENGINE_load_builtin_engines
  - ENGINE_cleanup
```

This declaration hooks the following two functions from the [OpenSSL library](https://docs.openssl.org/master/man3/ENGINE_add):

```c
void ENGINE_load_builtin_engines(void);
void ENGINE_cleanup(void);
```

To hook a symbol while also overriding its `decoderSettings`, write the hook as a `[<symbol name>, {<decoder settings>}]` tuple instead of a plain string.

**Example:**

```yaml
module: libssl.so
hooks:
  - [SSL_write, { maxItems: 16 }]
```

This hooks `SSL_write` from `libssl.so`, with `maxItems` set to `16` for that hook only. Every native event carries the function's `address` and a `hashCode` of it.

## Hooking Functions Without a Symbol

Functions that a module does not export, for example ones you found by reverse engineering a stripped library, can't be hooked by `symbol`. Use `offset` instead: the function's offset from the base address the module is loaded at. Every hook needs exactly one of `symbol` or `offset`.

```yaml
module: libfoo.so
hooks:
  - offset: 0x1a2b4
    retType: int
    params:
      - [const char *, input]
      - [size_t, length]
```

frooky hooks the function at `<base address of libfoo.so> + 0x1a2b4`. Write the offset as a YAML number (`0x1a2b4`) or as a string starting with `0x` (`"0x1a2b4"`). A string without `0x` is rejected, because `"1234"` could be meant as hex or decimal. Leading zeros are allowed in a string, such as `"0x000000000001A2B4"`. Don't write them in an unquoted number: YAML reads `0001234` as an octal or decimal number, depending on the parser.

### Finding the Offset

Take the function's address from your disassembler and subtract the image base the disassembler loaded the module at:

```text
offset = address shown in the disassembler - image base
```

| Disassembler | Default image base for a `.so` | Function shown at | `offset`  |
| ------------ | ------------------------------ | ----------------- | --------- |
| IDA          | `0x0`                          | `0x1a2b4`         | `0x1a2b4` |
| Ghidra       | `0x100000`                     | `0x11a2b4`        | `0x1a2b4` |

Ghidra shows the image base in _Window → Memory Map_, where you can also set it to `0`, so that addresses can be copied unchanged. Other tools may use other defaults, so check the image base before copying addresses.

Keep in mind:

- **Use the virtual address, not the file offset.** A hex editor or a raw file view shows positions in the file, which are often different from the virtual address of code.
- **An offset only fits one build of the module and one ABI.** After an app update, or for the `arm64-v8a` and `x86_64` copies of the same library, the offsets are different. frooky skips a hook whose offset is outside the module or doesn't point to executable memory, but an offset that points to the wrong code in the same module can't be detected.
- **Late-loaded modules:** If the shared library is loaded dynamically via `dlopen` after application startup, frooky hooks it as soon as it loads (see [Dynamic Class and Module Resolution](./additional-features.md#dynamic-class-and-module-resolution)).

Events of these hooks contain `offset` instead of `symbol`, see [Output](./output.md#hook-native-events).

## Decoding Arguments and Return Values

When a function accepts parameters or returns a value, frooky needs to know how to decode them.

You can provide that information by declaring `retType` and `params` for each function. The type syntax follows standard [C function declaration](https://en.cppreference.com/w/c/language/function_declaration.html) style.

```yaml
module: <module name>
hooks:
  - symbol: <symbol name>
    retType: <type>                   # Optional
    params:                           # Optional
      - <parameter declaration>
```

**Example:**

```yaml
module: libssl.so
hooks:
  - symbol: OSSL_CMP_validate_cert_path
    retType: int
    params:
      - ["const OSSL_CMP_CTX *", ctx]
      - ["X509_STORE *", trusted_store]
      - ["X509 *", cert]
```

This declaration hooks the following function from the [OpenSSL library](https://docs.openssl.org/master/man3/OSSL_CMP_validate_msg/):

```c
int OSSL_CMP_validate_cert_path(const OSSL_CMP_CTX *ctx,
                                X509_STORE *trusted_store,
                                X509 *cert);
```

When these types are declared, frooky can decode arguments and return values using its built-in decoders.

A pointer to one of these types is read as that type, e.g. `int *` as an `int` and `char **` as the string that `char *` points to. With the role `length` in `decoderArgs`, a pointer is an array, see [Native Pointers and Arrays](./decoders-native.md#pointers-and-arrays). An array type is a pointer, e.g. `char *[]` is `char **`.

If a type is more complex, you may need further [decoder settings](./decoders.md#decoder-settings) (see also [Decoders for Native Hooks](./decoders-native.md)), such as `decoderArgs` or `direction`, to decode it correctly.

## Hook and Decoder Settings

`hookSettings` (e.g. `early`, `nativeStackTrace`, `platformStackTrace`, `maxStackFrames`, `callerFilter`) and `decoderSettings` (e.g. `maxDepth`, `maxItems`) can be declared on the hook collection (applying to every hook in it) or on an individual hook (overriding the hook collection for that hook only). See [Additional Features](./additional-features.md#settings-precedence), [Decoders](./decoders.md) and [Decoders for Native Hooks](./decoders-native.md) for the full list of options and how the file-level `settings`, the hook collection, an individual hook, and a parameter or return type are merged together.

**Example:**

```yaml
module: libssl.so
hookSettings:
  platformStackTrace: true
  nativeStackTrace: true
  maxStackFrames: 10
  callerFilter:
    - libapp.so
hooks:
  - symbol: SSL_write
    retType: int
    params:
      - ["SSL *", ssl]
      - [const void *, buf, { decoderArgs: { length: num } }]
      - [int, num]
```

> [!WARNING]
> Don't capture stack traces on high-frequency libc functions such as `open`, `read` or `malloc`. See [Dangerous Low-Level, Early, and High-Frequency Hooks](./additional-features.md#dangerous-low-level-early-and-high-frequency-hooks).
