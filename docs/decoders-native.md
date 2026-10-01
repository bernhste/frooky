# Decoders for Native Hooks

How frooky decodes the parameters and return values of native (C/C++) functions. The settings themselves are described in [Decoders](./decoders.md).

<!-- TOC -->

- [How frooky Picks a Decoder](#how-frooky-picks-a-decoder)
- [Pointers and Arrays](#pointers-and-arrays)
- [`decoderArg`: Lengths and Counts](#decoderarg-lengths-and-counts)
- [File Descriptors](#file-descriptors)
- [Flags and Enums](#flags-and-enums)
- [Named Decoders](#named-decoders)
- [`direction`: Output Parameters](#direction-output-parameters)
- [Limits](#limits)
- [Return Values](#return-values)

<!-- /TOC -->

## How frooky Picks a Decoder

A native value has no runtime type, so frooky decodes it by the type declared in the hook file (see [Native Hook Declaration](./native-hook-declaration.md)). frooky uses the first of these that applies:

1. **`decoder` in the decoder settings.** A decoder you choose always wins.
2. **A fundamental type** passed by value, such as `int`, `unsigned long`, `size_t`, `bool` or `double`, is decoded as that type. 64-bit integers, and on 64-bit devices also pointer-sized ones such as `size_t` and `long`, are decimal strings, since a JSON number can't hold every 64-bit value.
3. **A pointer to a fundamental type**, such as `int *` or `char **`, is read from memory, see [Pointers and Arrays](#pointers-and-arrays).
4. **Any other type**, such as `SSL *` or `FILE *`, is shown as its raw value in hex, e.g. the address of a struct.

`const` and `volatile` in a type are ignored.

## Pointers and Arrays

A pointer is read as its declared type: `int *` as one `int`, `char *` as a NUL-terminated string, `char **` by following both pointers to the string, and so on for every `*`. A NULL pointer on any level is `null`, as is memory that can't be read. A `void *` without a `decoderArg` is shown as its address, since its contents are unknown.

With a `decoderArg`, a pointer is an array with that many elements: `int *` with `count: 3` is `[3, 1, 4]`, and `char **` with `count: 2` is `["alpha", "beta"]`. At most `maxItems` elements are decoded. For `void *`, `char *` and `unsigned char *`, the `decoderArg` is the length of the buffer in bytes instead.

```yaml
module: libreceiveFundamentalReference.so
hooks:
  - symbol: count_chars
    params:
      - [ "const char **", strings, { decoderArg: count } ]
      - [ int, count ]
```

An array parameter is a pointer, so `char *[]` is the same as `char **`. In YAML, quote a type that contains `[]` inside a `[ ... ]` list.

With `decoder: nullTerminated`, a pointer to pointers is an array that ends at a NULL pointer, without a count. [`execve`](https://www.man7.org/linux/man-pages/man2/execve.2.html) passes `argv` and `envp` this way:

```yaml
module: libc.so
hooks:
  - symbol: execve
    retType: int
    params:
      - [ "const char *", path ]
      - [ "char *const []", argv, { decoder: nullTerminated } ]
      - [ "char *const []", envp, { decoder: nullTerminated, maxItems: 20 } ]
```

`argv` is decoded as e.g. `["ls", "-l", "/sdcard"]`. The elements are decoded as the type one `*` less, here `char *`. For a pointee frooky doesn't know, e.g. `FILE **`, they are shown as addresses.

See [`02_pointers_and_arrays.yaml`](examples/native/03_decoders/02_pointers_and_arrays.yaml).

## `decoderArg`: Lengths and Counts

`decoderArg` passes the value of another parameter, or with `$ret` the return value, to the decoder (see [`decoderArg`](./decoders.md#decoderarg-pass-arguments-to-decoder)). What the value means depends on the decoder of the parameter:

| Decoder of the parameter                       | `decoderArg` is                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `void *`, `unsigned char *`                    | The length of the buffer in bytes, decoded as hex                       |
| `char *`, and `decoder: string` on any pointer | The length of the string in bytes. NUL bytes in it don't end it.        |
| Other pointers (`int *`, `char **`, ...)       | The number of elements, see [Pointers and Arrays](#pointers-and-arrays) |
| Values passed by value, and unknown types      | Ignored                                                                 |

A value that isn't a non-negative number, such as `-1` when `read` fails, decodes the parameter as `null`.

[`send`](https://www.man7.org/linux/man-pages/man2/send.2.html) passes the length of `buf` as `len`:

```yaml
module: libc.so
hooks:
  - symbol: send
    retType: ssize_t
    params:
      - [int, sockfd]
      - [const void *, buf, { decoderArg: len, decoder: string }]
      - [size_t, len]
      - [int, flags]
```

[`read`](https://www.man7.org/linux/man-pages/man2/read.2.html) writes up to `count` bytes into `buf` and returns how many it wrote. `count` is only the size of the buffer, so the return value is the length. `$ret` needs `direction: out` and a `retType`:

```yaml
module: libc.so
hooks:
  - symbol: read
    retType: ssize_t
    params:
      - [int, fd]
      - [void *, buf, { direction: out, decoderArg: $ret, decoder: string }]
      - [size_t, count]
```

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
      - [ "unsigned char *", out, { direction: out, decoderArg: outl } ]
      - [ "int *", outl, { direction: out } ]
      - [ "const unsigned char *", in, { decoderArg: inl } ]
      - [ int, inl ]
```

See [`01_strings_and_buffers.yaml`](examples/native/03_decoders/01_strings_and_buffers.yaml).

## File Descriptors

With `decoder: fd`, an `int` file descriptor is decoded to what it refers to:

```json
{ "fd": 42, "path": "/data/user/0/org.example.app/files/token.txt" }
```

For a socket, frooky also reads its address family, socket type and addresses:

```json
{ "fd": 57, "path": "socket:[123456]", "family": "AF_INET", "socketType": "SOCK_STREAM", "local": "10.0.2.16:41234", "peer": "142.250.74.78:443" }
```

- `local` and `peer` are `IP:port` (`[IPv6]:port` for IPv6) or, for `AF_UNIX`, a path. On Android, a name in the abstract namespace starts with `@`. They are `null` if the socket has no address, e.g. `peer` before `connect`.
- Pipes and other kinds of fds only have a `path`, e.g. `pipe:[678]` or `anon_inode:[eventfd]`.
- On Android, the `path` is read from `/proc/self/fd`. On iOS, it is read with `fcntl(F_GETPATH)`, which only has a path for files, so it is `null` for sockets and pipes.
- A negative fd, e.g. `-1` when `open` fails, and an fd that isn't open have `path: null`. For an fd that `close` closes, decode it at the call (the default), not with `direction: out`.

The decoder only reads the state of the fd. It works on the return value too, e.g. `retType: [int, { decoder: fd }]` for `open` and `socket`.

```yaml
module: libc.so
hooks:
  - symbol: read
    retType: ssize_t
    params:
      - [ int, fd, { decoder: fd } ]
      - [ "void *", buf, { direction: out, decoderArg: $ret, decoder: string } ]
      - [ size_t, count ]
```

See [`03_file_descriptors.yaml`](examples/native/03_decoders/03_file_descriptors.yaml).

## Flags and Enums

An integer that stands for a named constant is decoded to that name:

- `decoder: enum`: the name of the constant with exactly this value, e.g. `"LOG_LEVEL_WARN"`. A value without a constant is decoded as the number.
- `decoder: flags`: the names of the constants whose bits are set, as a list, e.g. `["PERMISSION_READ", "PERMISSION_SHARE"]`. Bits that no constant has are added as one hex string, e.g. `"0x100"`. A constant with the value `0` is only shown if no bit is set, and a constant with several bits wins over the constants it includes.

The `constants` setting maps the names to their values. YAML reads `0x40` as a number, so hex values can be written as they are in C headers:

```yaml
module: libfoo.so
hooks:
  - symbol: set_permissions
    params:
      - [ unsigned int, permissions, { decoder: flags, constants: { PERMISSION_READ: 0x1, PERMISSION_WRITE: 0x2, PERMISSION_SHARE: 0x4 } } ]
```

The value is read with the size of its declared type, e.g. 32 bits for `int` and `unsigned int`. A type frooky doesn't know, e.g. `mode_t`, is read as 32 bits, the size of a C enum.

For the flags and enums of system calls, frooky has presets. They don't need `constants`:

| Decoder        | For                                       | Example                              |
| -------------- | ----------------------------------------- | ------------------------------------ |
| `openFlags`    | `flags` of `open`, `openat`               | `["O_WRONLY", "O_CREAT", "O_TRUNC"]` |
| `mmapProt`     | `prot` of `mmap`, `mprotect`              | `["PROT_READ", "PROT_EXEC"]`         |
| `mmapFlags`    | `flags` of `mmap`                         | `["MAP_PRIVATE", "MAP_ANONYMOUS"]`   |
| `dlopenFlags`  | `flags` of `dlopen`, `android_dlopen_ext` | `["RTLD_NOW", "RTLD_GLOBAL"]`        |
| `socketDomain` | `domain` of `socket` (an enum)            | `"AF_INET6"`                         |
| `socketType`   | `type` of `socket`                        | `["SOCK_STREAM", "SOCK_CLOEXEC"]`    |

Each preset has two tables, and frooky picks the one for the platform of the app:

- **Android** (and Linux), arm64 and x86_64: the values of the Linux kernel and Bionic. The kernel keeps them stable, but a few `O_*` flags differ between arm64 and x86_64, e.g. `O_DIRECTORY`.
- **iOS** (and macOS): the values of the XNU kernel and libSystem, which are the same on every architecture. They differ from Android's, e.g. `O_CREAT` is `0x200` instead of `0x40`, and some constants only exist on one platform, e.g. `SOCK_CLOEXEC` only on Android and `MAP_JIT` only on iOS. frooky doesn't hook iOS apps yet, so the iOS values aren't tested against an app.

For 32-bit apps and other platforms, a preset logs a warning and the value is decoded as a number.

```yaml
module: libc.so
hooks:
  - symbol: openat
    retType: [ int, { decoder: fd } ]
    params:
      - [ int, dirfd ]
      - [ "const char *", path ]
      - [ int, flags, { decoder: openFlags } ]
      - [ mode_t, mode ]
```

See [`04_flags_and_enums.yaml`](examples/native/03_decoders/04_flags_and_enums.yaml).

## Named Decoders

Native hooks have these registered decoders:

- `fd`: decodes an `int` file descriptor to the file, socket or pipe it refers to, see [File Descriptors](#file-descriptors).
- `enum` and `flags`: decode an integer to the names in `constants`, see [Flags and Enums](#flags-and-enums). The presets `openFlags`, `mmapProt`, `mmapFlags`, `dlopenFlags`, `socketDomain` and `socketType` have the constants built in.
- `nullTerminated`: decodes a pointer to pointers, e.g. `char **`, as an array that ends at a NULL pointer, see [Pointers and Arrays](#pointers-and-arrays).
- `string`: decodes a pointer (`void *`, ...) as a UTF-8 string, or as ASCII if the bytes aren't valid UTF-8. Without a `decoderArg`, the string ends at its NUL terminator. With a `decoderArg`, that parameter's value is the buffer length and exactly that many bytes are decoded, so buffers that aren't NUL-terminated can be decoded too. NUL bytes inside the buffer don't end the string; they are decoded like any other byte (as `.` when decoded as ASCII). At most `maxItems` bytes are decoded, and a longer string ends with `...`.

`char *` is always decoded this way, and so is `unsigned char *` without a `decoderArg`, so they don't need `decoder: string`.

```yaml
module: libc.so
hooks:
  - symbol: read
    retType: ssize_t
    params:
      - [int, fd]
      - [void *, buf, { direction: out, decoderArg: $ret, decoder: string, maxItems: 200 }]
      - [size_t, count]
```

## `direction`: Output Parameters

OpenSSL's [`RAND_bytes`](https://docs.openssl.org/3.0/man3/RAND_bytes/) fills `buf` with `num` random bytes, so `buf` is only meaningful after the call:

```yaml
module: libcrypto.so
hooks:
  - symbol: RAND_bytes
    retType: int
    params:
      - [ "unsigned char *", buf, { direction: out, decoderArg: num } ]
      - [ int, num ]
```

See [`02_output_parameters.yaml`](examples/native/02_parameters_and_return_values/02_output_parameters.yaml).

## Limits

What `maxItems` limits for each decoder (see [`maxItems` and `maxDepth`](./decoders.md#maxitems-and-maxdepth-limit-large-and-nested-values)). Native decoders don't nest, so `maxDepth` doesn't apply.

| Decoder                               | `maxItems` limits          |
| ------------------------------------- | -------------------------- |
| `char *`, `unsigned char *`, `void *` | Bytes read from the buffer |
| Other pointers with a `decoderArg`    | Elements of the array      |
| `nullTerminated`                      | Elements of the array      |

Strings and buffers decoded as hex end with `...` when they're cut, arrays end with a `"[truncated at N]"` marker.

## Return Values

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
