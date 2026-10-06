# `NativeHook` Declaration

A native hook collection hooks functions of one native module, e.g. a shared library such as `libssl.so`.

<!-- TOC -->

- [Structure](#structure)
- [Basic Usage](#basic-usage)
  - [Functions From Other Libraries](#functions-from-other-libraries)
- [Symbol Wildcards](#symbol-wildcards)
- [Module Wildcards](#module-wildcards)
- [Hooking Functions Without a Symbol](#hooking-functions-without-a-symbol)
  - [Finding the Offset](#finding-the-offset)
- [Decoding Arguments and Return Values](#decoding-arguments-and-return-values)
- [Hook and Decoder Settings](#hook-and-decoder-settings)

<!-- /TOC -->

## Structure

```yaml
module: <module name>
hookSettings:                       # Optional. Override the file's settings for this collection
  <hook settings>
decoderSettings:                    # Optional
  <decoder settings>
hooks:
  - <symbol>                                          # short form
  - [<symbol>, { <decoder settings> }]                # short form with settings
  - symbol: <symbol>                                  # expanded form, or `offset: <offset>`
    retType: <return type declaration>  # Optional
    params:                             # Optional
      - <parameter declaration>
    hookSettings:                       # Optional. Override the collection's settings for this hook
      <hook settings>
    decoderSettings:                    # Optional
      <decoder settings>
```

| Form                | Use it to                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Short               | Record the calls of a function, without its arguments or return value                                                                      |
| Short with settings | The same, with its own `decoderSettings`                                                                                                   |
| Expanded            | Decode arguments (`params`) and the return value (`retType`), hook by [`offset`](#hooking-functions-without-a-symbol), or set own settings |

A native function has no type information at runtime, so frooky only decodes what `params` and `retType` declare. See [Parameter Declaration](./parameter-declaration.md) and [Return Type Declaration](./return-type-declaration.md).

## Basic Usage

```yaml
module: libssl.so
hooks:
  - ENGINE_load_builtin_engines
  - ENGINE_cleanup
```

This hooks these two functions of [OpenSSL](https://docs.openssl.org/master/man3/ENGINE_add):

```c
void ENGINE_load_builtin_engines(void);
void ENGINE_cleanup(void);
```

### Functions From Other Libraries

frooky only hooks a function that the module defines itself. A function the module calls from a library it links, e.g. `malloc` from `libc.so`, isn't the module's: a hook on it would record the calls of the whole process. frooky skips such a hook with a warning that names the library that defines it:

```text
Skipping hook for 'malloc'. Module 'libfoo.so' doesn't define it but links it from 'libc.so': hook it there with 'module: libc.so', and with 'callerFilter: ['^libfoo\.so$']' for its calls from 'libfoo.so' only.
```

To record the module's calls of such a function, hook it in the library that defines it, with a [caller filter](./additional-features.md#caller-filters) on the module:

```yaml
module: libc.so
hookSettings:
  callerFilter: ['^libfoo\.so$']
hooks:
  - malloc
```

## Symbol Wildcards

A `*` or `**` in a symbol matches any characters, also none. frooky hooks every exported function of the module whose name matches.

```yaml
module: libc.so
hooks:
  - inet_*        # inet_addr, inet_aton, inet_ntop, inet_pton, ...
  - "*addrinfo"   # getaddrinfo, freeaddrinfo
```

- A pattern only matches exported functions, not exported variables.
- YAML reads a value that starts with `*` as an alias, so quote it: `"*addrinfo"`.
- `params` and `retType` apply to every matching function, so only use them for functions with the same signature.
- If several matching names belong to one function (e.g. `memcpy` and `memmove` in some libcs), frooky hooks it once, under the first name.
- Functions that frooky never hooks (e.g. `pthread_getspecific`, see [Blocked Functions](./additional-features.md#blocked-functions)) are skipped with a warning, also when a pattern matches them. A broad pattern on `libc.so` can still match functions the app calls very often, which slows it down.

See [`03_symbol_wildcards.yaml`](./examples/native/01_basic_hooking/03_symbol_wildcards.yaml).

## Module Wildcards

A `*` or `**` in `module` matches any characters, also none. frooky hooks each declared function in every matching module that exports it: in the modules loaded already, and in each matching module that loads later, while it loads.

```yaml
module: libssl*.so      # libssl.so, libssl3.so, libssl_static.so, ...
hooks:
  - SSL_write
  - SSL_read*           # also with a symbol wildcard
```

- The pattern matches the module's file name, not its path.
- A matching module that doesn't export the function is skipped without a warning. The hook waits until a matching module with the function loads.
- `offset` needs an exact module name: an offset only fits one build of one library.
- A broad pattern, e.g. `lib*.so`, reads the exports of every module it matches, which takes time at startup and whenever a matching module loads.
- The [hook statistics](./additional-features.md#hook-statistics-s--s-key) list each hooked function with its module.

See [`04_module_wildcards.yaml`](./examples/native/01_basic_hooking/04_module_wildcards.yaml).

## Hooking Functions Without a Symbol

A function the module doesn't export, e.g. one found by reverse engineering a stripped library, is hooked by `offset`: its offset from the module's base address. Every hook has exactly one of `symbol` or `offset`.

```yaml
module: libfoo.so
hooks:
  - offset: 0x1a2b4
    retType: int
    params:
      - ["const char *", input]
      - [size_t, length]
```

frooky hooks the function at `<base address of libfoo.so> + 0x1a2b4`. Write the offset as a YAML number (`0x1a2b4`) or as a string starting with `0x` (`"0x000000000001A2B4"`, leading zeros allowed). A string without `0x` is rejected, because `"1234"` could be meant as hex or decimal. Don't write leading zeros in an unquoted number: YAML reads `0001234` as octal or decimal, depending on the parser.

Events of these hooks contain `offset` instead of `symbol`, see [Output](./output.md#hook-native-events).

### Finding the Offset

Take the function's address from your disassembler and subtract the image base the disassembler loaded the module at:

| Disassembler | Default image base for a `.so` | Function shown at | `offset`  |
| ------------ | ------------------------------ | ----------------- | --------- |
| IDA          | `0x0`                          | `0x1a2b4`         | `0x1a2b4` |
| Ghidra       | `0x100000`                     | `0x11a2b4`        | `0x1a2b4` |

Ghidra shows the image base in _Window → Memory Map_, where you can also set it to `0` to copy addresses unchanged. Check the image base of other tools before copying addresses.

- **Use the virtual address, not the file offset.** A hex editor shows positions in the file, which often differ from the virtual address of the code.
- **An offset only fits one build and one ABI of the module.** After an app update, or for the `arm64-v8a` and `x86_64` copies of a library, the offsets differ. frooky skips a hook whose offset is outside the module or not in executable memory, but can't detect an offset that points to the wrong code.

## Decoding Arguments and Return Values

`params` and `retType` are written as C types:

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

This hooks this function of [OpenSSL](https://docs.openssl.org/master/man3/OSSL_CMP_validate_msg/):

```c
int OSSL_CMP_validate_cert_path(const OSSL_CMP_CTX *ctx,
                                X509_STORE *trusted_store,
                                X509 *cert);
```

How each type is decoded, e.g. `char *` as a string and `int *` as the `int` it points to, is described in [Decoders for Native Hooks](./decoders-native.md). Buffers and output parameters need [decoder settings](./decoders.md#decoder-settings) such as `decoderArgs` and `direction`.

## Hook and Decoder Settings

`hookSettings` and `decoderSettings` can be set on the collection, for all its hooks, or on a hook in the expanded form, overriding the collection. See [Settings Precedence](./additional-features.md#settings-precedence), [Stack Traces](./additional-features.md#stack-traces), [Caller Filters](./additional-features.md#caller-filters), [Early Hooking](./additional-features.md#early-hooking) and [Decoders](./decoders.md).

```yaml
module: libssl.so
hookSettings:
  nativeStackTrace: true
  maxStackFrames: 10
  callerFilter: ['^libapp\.so$']
hooks:
  - symbol: SSL_write
    retType: int
    params:
      - ["SSL *", ssl]
      - ["const void *", buf, { decoderArgs: { length: num } }]
      - [int, num]
```

> [!WARNING]
> Don't capture stack traces on high-frequency libc functions such as `open`, `read` or `malloc`. See [Dangerous Low-Level and High-Frequency Hooks](./additional-features.md#dangerous-low-level-and-high-frequency-hooks).
