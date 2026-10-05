# Decoders for Native Hooks

How frooky decodes the parameters and return values of native (C/C++) functions. The settings themselves are described in [Decoders](./decoders.md).

<!-- TOC -->

- [How frooky Picks a Decoder](#how-frooky-picks-a-decoder)
- [Pointers and Arrays](#pointers-and-arrays)
- [`decoderArgs`: Length and Offset](#decoderargs-length-and-offset)
- [UTF-16 Strings](#utf-16-strings)
- [File Descriptors](#file-descriptors)
- [Constants and Bitmasks](#constants-and-bitmasks)
- [errno](#errno)
- [Named Decoders](#named-decoders)
- [`direction`: Output Parameters](#direction-output-parameters)
- [Limits](#limits)
- [Return Values](#return-values)

<!-- /TOC -->

## How frooky Picks a Decoder

A native value has no runtime type, so frooky decodes it by the type declared in the hook file (see [Native Hook Declaration](./native-hook-declaration.md)). frooky uses the first of these that applies:

1. **`decoder` in the decoder settings.** A decoder you choose always wins.
2. **A fundamental type** passed by value, such as `int`, `unsigned long`, `size_t`, `bool` or `double`, is decoded as that type. 64-bit integers, including `long`, `size_t` and `ssize_t`, are decimal strings, since a JSON number can't hold every 64-bit value.
3. **A pointer to a UTF-16 code unit**, such as `const jchar *` or `char16_t *`, is read as a UTF-16 string, see [UTF-16 Strings](#utf-16-strings).
4. **A pointer to a fundamental type**, such as `int *` or `char **`, is read from memory, see [Pointers and Arrays](#pointers-and-arrays).
5. **Any other type**, such as `SSL *` or `FILE *`, is shown as its raw value in hex, e.g. the address of a struct.

`const` and `volatile` in a type are ignored.

## Pointers and Arrays

A pointer is read as its declared type: `int *` as one `int`, `char *` as a NUL-terminated string, `char **` by following both pointers to the string, and so on for every `*`. A NULL pointer on any level is `null`, as is memory that can't be read. A `void *` without the role `length` is shown as its address, since its contents are unknown.

With the role `length` in `decoderArgs`, a pointer is an array with that many elements: `int *` with a length of 3 is `[3, 1, 4]`, and `char **` with a length of 2 is `["alpha", "beta"]`. At most `maxItems` elements are decoded. For `void *`, `char *` and `unsigned char *`, the length is in bytes instead, see [`decoderArgs`](#decoderargs-length-and-offset).

```yaml
module: libreceiveFundamentalReference.so
hooks:
  - symbol: count_chars
    params:
      - [ "const char **", strings, { decoderArgs: { length: count } } ]
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

An array of strings has two kinds of terminators. Each string ends with a `\0` byte, and the array of pointers ends with a NULL pointer (8 zero bytes in a 64-bit app). For `char *const argv[] = {"ls", "-l", "/sdcard", NULL}`, the memory looks like this (with made-up addresses):

```text
argv ─► 0x7f00a000:  00 b0 00 00 7f 00 00 00   → 0x7f0000b000  argv[0]
        0x7f00a008:  10 b0 00 00 7f 00 00 00   → 0x7f0000b010  argv[1]
        0x7f00a010:  20 b0 00 00 7f 00 00 00   → 0x7f0000b020  argv[2]
        0x7f00a018:  00 00 00 00 00 00 00 00   → NULL, the end of the array

0x7f0000b000:  6c 73 00                  "ls\0"
0x7f0000b010:  2d 6c 00                  "-l\0"
0x7f0000b020:  2f 73 64 63 61 72 64 00   "/sdcard\0"
```

A string is always read up to its `\0`. `decoder: nullTerminated` adds the outer loop: frooky reads one pointer after the other until it reaches the NULL pointer, and decodes each element as the type with one `*` less, here `char *`. So `argv` is decoded as `["ls", "-l", "/sdcard"]`. Without `nullTerminated`, only the first pointer is followed (`"ls"`), and with `decoderArgs: { length: argc }` exactly `argc` elements are read.

For a pointee frooky doesn't know, e.g. `FILE **`, the elements are shown as addresses. On a single pointer such as `char *`, `nullTerminated` has no effect: the string is read up to its `\0`, as without the decoder.

See [`02_pointers_and_arrays.yaml`](examples/native/03_decoders/02_pointers_and_arrays.yaml).

## `decoderArgs`: Length and Offset

`decoderArgs` passes values to the decoder of a parameter, each in a role (see [`decoderArgs`](./decoders.md#decoderargs-pass-values-to-the-decoder-by-role)). Native decoders accept these roles:

| Decoder of the parameter                                                                          | Role `length`                                                          | Role `offset`                    |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------- |
| `void *`, `unsigned char *`                                                                       | Bytes of the buffer, decoded as hex                                    | Bytes to skip                    |
| `char *`, and `decoder: string` on any pointer                                                    | Bytes of the string. NUL bytes in it don't end it.                     | Bytes to skip                    |
| `decoder: base64`                                                                                 | Bytes of the base64 text                                               | Bytes to skip                    |
| Other pointers (`int *`, `char **`, ...)                                                          | Elements of the array, see [Pointers and Arrays](#pointers-and-arrays) | Elements to skip                 |
| `decoder: nullTerminated`                                                                         | –                                                                      | Elements to skip, e.g. `argv[0]` |
| UTF-16 pointers (`const jchar *`, ...), and `decoder: utf16`                                      | Code units of the string (2 bytes each). 0 units in it don't end it.   | Code units to skip               |
| Values passed by value, unknown types, and the other decoders (`fd`, `constants`, `bitmask`, ...) | –                                                                      | –                                |

Without `offset`, decoding starts at the pointer. Without `length`, a `char *` ends at its `\0`, and other pointers are read as one element. C usually passes a slice as a pointer to its start (`buf + off`), so `offset` is only needed for APIs that pass the start and the offset separately.

A value that isn't a non-negative integer, such as `-1` when `read` fails, decodes the parameter as `null`.

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

[`read`](https://www.man7.org/linux/man-pages/man2/read.2.html) writes up to `count` bytes into `buf` and returns how many it wrote. `count` is only the size of the buffer, so the return value is the length. `$ret` needs `direction: out` and a `retType`:

```yaml
module: libc.so
hooks:
  - symbol: read
    retType: ssize_t
    params:
      - [int, fd]
      - [void *, buf, { direction: out, decoderArgs: { length: $ret }, decoder: string }]
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
      - [ "unsigned char *", out, { direction: out, decoderArgs: { length: outl } } ]
      - [ "int *", outl, { direction: out } ]
      - [ "const unsigned char *", in, { decoderArgs: { length: inl } } ]
      - [ int, inl ]
```

See [`01_strings_and_buffers.yaml`](examples/native/03_decoders/01_strings_and_buffers.yaml).

## UTF-16 Strings

Most native code on Android and iOS uses UTF-8, but some APIs pass UTF-16 strings:

- JNI: `GetStringChars` and `GetStringCritical` return a `const jchar *`, `NewString` takes one.
- Binder (`android::String16`) and ICU (`const UChar *`) on Android.
- CoreFoundation and Foundation on iOS, e.g. `CFStringGetCharacters` (`UniChar *`) and `-[NSString initWithCharacters:length:]` (`const unichar *`).

A pointer to `char16_t`, `jchar`, `unichar`, `UniChar` or `UChar` is decoded as a UTF-16 string. For other types, e.g. `uint16_t *` or `void *`, use `decoder: utf16`. Without the role `length`, the string ends at a 0 code unit. JNI strings have no terminator, so they need the length, which JNI and CoreFoundation count in code units:

```yaml
module: libfoo.so
hooks:
  - symbol: Java_org_example_Native_process
    params:
      - [ "const jchar *", chars, { decoderArgs: { length: len } } ]
      - [ jsize, len ]
```

At most `maxItems` code units are decoded. A cut string ends with `...` and never ends with half of a character that takes two code units, such as an emoji. `wchar_t` isn't UTF-16 on Android and iOS, but 4 bytes per character, so `wchar_t *` isn't decoded as UTF-16.

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
      - [ "void *", buf, { direction: out, decoderArgs: { length: $ret }, decoder: string } ]
      - [ size_t, count ]
```

See [`03_file_descriptors.yaml`](examples/native/03_decoders/03_file_descriptors.yaml).

## Constants and Bitmasks

An integer that stands for a named constant is decoded to that name:

- `decoder: constants`: the name of the constant with exactly this value, e.g. `"LOG_LEVEL_WARN"`. A value without a constant is decoded as the number.
- `decoder: bitmask`: the names of the constants whose bits are set, as a list, e.g. `["PERMISSION_READ", "PERMISSION_SHARE"]`. Bits that no constant has are added as one hex string, e.g. `"0x100"`. A constant with the value `0` is only shown if no bit is set, and a constant with several bits wins over the constants it includes.

`config: { constants }` maps the names to their values. YAML reads `0x40` as a number, so hex values can be written as they are in C headers:

```yaml
module: libfoo.so
hooks:
  - symbol: set_permissions
    params:
      - [ unsigned int, permissions, { decoder: bitmask, config: { constants: { PERMISSION_READ: 0x1, PERMISSION_WRITE: 0x2, PERMISSION_SHARE: 0x4 } } } ]
```

The value is read with the size of its declared type, e.g. 32 bits for `int` and `unsigned int`. A type frooky doesn't know, e.g. `mode_t`, is read as 32 bits, the size of a C enum.

For the flags and constants of system calls, frooky has presets. They have the constants built in and accept no `config`:

| Decoder        | For                                       | Example                              |
| -------------- | ----------------------------------------- | ------------------------------------ |
| `openFlags`    | `flags` of `open`, `openat`               | `["O_WRONLY", "O_CREAT", "O_TRUNC"]` |
| `mmapProt`     | `prot` of `mmap`, `mprotect`              | `["PROT_READ", "PROT_EXEC"]`         |
| `mmapFlags`    | `flags` of `mmap`                         | `["MAP_PRIVATE", "MAP_ANONYMOUS"]`   |
| `dlopenFlags`  | `flags` of `dlopen`, `android_dlopen_ext` | `["RTLD_NOW", "RTLD_GLOBAL"]`        |
| `socketDomain` | `domain` of `socket` (one constant)       | `"AF_INET6"`                         |
| `socketType`   | `type` of `socket`                        | `["SOCK_STREAM", "SOCK_CLOEXEC"]`    |

Each preset has two tables, and frooky picks the one for the platform of the app:

- **Android** (and Linux), arm64 and x86_64: the values of the Linux kernel and Bionic. The kernel keeps them stable, but a few `O_*` flags differ between arm64 and x86_64, e.g. `O_DIRECTORY`.
- **iOS** (and macOS): the values of the XNU kernel and libSystem, which are the same on every architecture. They differ from Android's, e.g. `O_CREAT` is `0x200` instead of `0x40`, and some constants only exist on one platform, e.g. `SOCK_CLOEXEC` only on Android and `MAP_JIT` only on iOS. frooky doesn't hook iOS apps yet, so the iOS values aren't tested against an app.

On other platforms, a preset logs a warning and the value is decoded as a number.

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

See [`04_constants_and_bitmasks.yaml`](examples/native/03_decoders/04_constants_and_bitmasks.yaml).

## errno

Many C functions report an error by returning `-1` (or `NULL`) and set `errno` to its reason. With `decoder: errno` on the return value, frooky decodes the return value as its declared type and adds `errno` if the return value reports an error:

```json
{ "value": -1, "errno": { "number": 2, "name": "ENOENT", "message": "No such file or directory" } }
```

- An error is `-1`, read with the size of the return type (32 bits for `int`, 64 bits for `ssize_t` or `long`), or `NULL` or `MAP_FAILED` (`(void *) -1`) for a pointer. For other return values, `errno` is `null`, since a function only sets `errno` on an error.
- `name` is the name of the constant, `null` for a number frooky has no name for. The numbers differ between Android and iOS above 34, e.g. `11` is `EAGAIN` on Android and `EDEADLK` on iOS. `message` comes from `strerror` of the C library.
- frooky reads `errno` right when the function returns, before anything else can change it.
- Functions that return the error number themselves, such as `pthread_create`, don't use `errno`. Use `decoder: constants` for them.

`decoder: errno` is only supported on the return value. A native hook needs a `retType` for it:

```yaml
module: libc.so
hooks:
  - symbol: connect
    retType: [ int, { decoder: errno } ]
    params:
      - [ int, sockfd, { decoder: fd } ]
      - [ "const void *", addr ]
      - [ int, addrlen ]
```

See [`05_errno.yaml`](examples/native/03_decoders/05_errno.yaml).

## Named Decoders

Native hooks have these registered decoders:

- `utf16`: decodes a pointer as a UTF-16 string, see [UTF-16 Strings](#utf-16-strings).
- `errno`: on the return value, adds the `errno` of a call that failed, see [errno](#errno).
- `fd`: decodes an `int` file descriptor to the file, socket or pipe it refers to, see [File Descriptors](#file-descriptors).
- `constants` and `bitmask`: decode an integer to the names in `config: { constants }`, see [Constants and Bitmasks](#constants-and-bitmasks). The presets `openFlags`, `mmapProt`, `mmapFlags`, `dlopenFlags`, `socketDomain` and `socketType` have the constants built in.
- `nullTerminated`: decodes a pointer to pointers, e.g. `char **`, as an array that ends at a NULL pointer, see [Pointers and Arrays](#pointers-and-arrays).
- `base64`: Base64-decodes the string a pointer points to. Without the role `length`, it ends at its NUL terminator, with it, it is that many bytes long. The role `offset` skips bytes at the start. Standard and URL-safe base64 are decoded, with or without padding, and whitespace such as line breaks is ignored. The decoded bytes are shown as text if they're printable UTF-8 text, otherwise as hex, e.g. a key. At most `maxItems` decoded bytes are shown, and longer output ends with `...`. Text that isn't base64 is decoded like with `string`, and frooky logs a warning.
- `string`: decodes a pointer (`void *`, ...) as a UTF-8 string, or as ASCII if the bytes aren't valid UTF-8. Without the role `length`, the string ends at its NUL terminator. With it, exactly that many bytes are decoded, so buffers that aren't NUL-terminated can be decoded too. The role `offset` skips bytes at the start. NUL bytes inside the buffer don't end the string; they are decoded like any other byte (as `.` when decoded as ASCII). At most `maxItems` bytes are decoded, and a longer string ends with `...`.

`char *` is always decoded this way, and so is `unsigned char *` without the role `length`, so they don't need `decoder: string`.

```yaml
module: libc.so
hooks:
  - symbol: read
    retType: ssize_t
    params:
      - [int, fd]
      - [void *, buf, { direction: out, decoderArgs: { length: $ret }, decoder: string, maxItems: 200 }]
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
      - [ "unsigned char *", buf, { direction: out, decoderArgs: { length: num } } ]
      - [ int, num ]
```

See [`02_output_parameters.yaml`](examples/native/02_parameters_and_return_values/02_output_parameters.yaml).

## Limits

What `maxItems` limits for each decoder (see [`maxItems` and `maxDepth`](./decoders.md#maxitems-and-maxdepth-limit-large-and-nested-values)). Native decoders don't nest, so `maxDepth` doesn't apply.

| Decoder                               | `maxItems` limits          |
| ------------------------------------- | -------------------------- |
| `char *`, `unsigned char *`, `void *` | Bytes read from the buffer |
| `base64`                              | Decoded bytes              |
| Other pointers with the role `length` | Elements of the array      |
| `nullTerminated`                      | Elements of the array      |
| UTF-16 pointers, `utf16`              | Code units of the string   |

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
