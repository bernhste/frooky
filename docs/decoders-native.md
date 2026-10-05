# Decoders for Native Hooks

How frooky decodes the parameters and return values of native (C/C++) functions. The decoder settings, including the `decoderArgs` roles and the limits of each native decoder, and the decoders shared with Java hooks (`string`, `base64`, `hex`, `constants`, `bitmask`) are described in [Decoders](./decoders.md).

<!-- TOC -->

- [How frooky Picks a Decoder](#how-frooky-picks-a-decoder)
- [Pointers and Arrays](#pointers-and-arrays)
- [UTF-16 Strings](#utf-16-strings)
- [File Descriptors](#file-descriptors)
- [Constant Presets](#constant-presets)
- [errno](#errno)
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

With the role `length` in `decoderArgs`, a pointer is an array with that many elements: `int *` with a length of 3 is `[3, 1, 4]`, and `char **` with a length of 2 is `["alpha", "beta"]`. At most `maxItems` elements are decoded. For `void *`, `char *` and `unsigned char *`, the length is in bytes instead, see [roles of native decoders](./decoders.md#roles-of-native-decoders).

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

## UTF-16 Strings

Most native code on Android uses UTF-8, but some APIs pass UTF-16 strings:

- JNI: `GetStringChars` and `GetStringCritical` return a `const jchar *`, `NewString` takes one.
- Binder (`android::String16`) and ICU (`const UChar *`) on Android.

A pointer to `char16_t`, `jchar`, `unichar`, `UniChar` or `UChar` is decoded as a UTF-16 string. For other types, e.g. `uint16_t *` or `void *`, use `decoder: utf16`. Without the role `length`, the string ends at a 0 code unit. JNI strings have no terminator, so they need the length, which JNI counts in code units. `receive_utf16` of the native target app gets a string like that:

```yaml
module: libreceiveString.so
hooks:
  - symbol: receive_utf16
    params:
      - [ "const char16_t *", s, { decoderArgs: { length: len } } ]
      - [ int, len ]
```

This decodes `s` as `"Grüezi"`, from its 6 code units.

At most `maxItems` code units are decoded. A cut string ends with `...` and never ends with half of a character that takes two code units, such as an emoji. `wchar_t` isn't UTF-16 on Android, but 4 bytes per character, so `wchar_t *` isn't decoded as UTF-16.

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
- The `path` is read from `/proc/self/fd`.
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

## Constant Presets

`decoder: constants` and `decoder: bitmask` decode an integer to the names of its constants, see [`constants` and `bitmask`](./decoders.md#constants-and-bitmask-decode-named-constants). For the flags and constants of system calls, frooky has presets. They have the constants built in and accept no `config`:

| Decoder        | For                                       | Example                              |
| -------------- | ----------------------------------------- | ------------------------------------ |
| `openFlags`    | `flags` of `open`, `openat`               | `["O_WRONLY", "O_CREAT", "O_TRUNC"]` |
| `mmapProt`     | `prot` of `mmap`, `mprotect`              | `["PROT_READ", "PROT_EXEC"]`         |
| `mmapFlags`    | `flags` of `mmap`                         | `["MAP_PRIVATE", "MAP_ANONYMOUS"]`   |
| `dlopenFlags`  | `flags` of `dlopen`, `android_dlopen_ext` | `["RTLD_NOW", "RTLD_GLOBAL"]`        |
| `socketDomain` | `domain` of `socket` (one constant)       | `"AF_INET6"`                         |
| `socketType`   | `type` of `socket`                        | `["SOCK_STREAM", "SOCK_CLOEXEC"]`    |

The values are those of the Linux kernel and Bionic. A few `O_*` flags differ between arm64 and x86_64, e.g. `O_DIRECTORY`, and frooky uses the ones of the app's architecture.

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
- `name` is the name of the constant, `null` for a number frooky has no name for. `message` comes from `strerror` of the C library.
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
