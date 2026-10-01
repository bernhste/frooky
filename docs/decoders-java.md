# Decoders for Android Java Hooks

How frooky decodes the parameters and return values of Java and Kotlin methods. The settings themselves are described in [Decoders](./decoders.md).

<!-- TOC -->

- [How frooky Picks a Decoder](#how-frooky-picks-a-decoder)
- [Built-in Decoders](#built-in-decoders)
- [Named Decoders](#named-decoders)
- [`direction`: Output Parameters](#direction-output-parameters)
- [`decoderArg`](#decoderarg)
- [Limits](#limits)
- [Return Values](#return-values)

<!-- /TOC -->

## How frooky Picks a Decoder

frooky picks the decoder by the object's runtime class, not by the type declared in the hook file. A parameter declared as `java.lang.Object` that receives a `HashMap` is decoded as a map. frooky uses the first of these that applies:

1. **`decoder` in the decoder settings.** A decoder you choose always wins. If it fails on a value, frooky logs a warning and decodes the value as if no `decoder` were set.
2. **A class decoder** for the runtime class or, if there is none, for its nearest superclass. `Intent` has one, so a `LabeledIntent`, a subclass of `Intent`, is decoded like an `Intent`.
3. **An interface decoder** for an interface the class implements, such as `java.util.Map` or `java.lang.Iterable`. If there are several, the most specific one wins: an interface that extends another one, e.g. `java.util.Collection` over `java.lang.Iterable`. If unrelated interfaces remain, e.g. a class that implements both `Map` and `Iterable`, the first one in frooky's list wins (`Map` before `Iterable`) and frooky logs a warning. Set `decoder` to choose another one.
4. **`toString()`** of the object.

Primitives, `java.lang.String` and arrays are decoded by their declared type. With `-v`, frooky logs which decoder it picked for each runtime class and why. See [`04_decoder_resolution.yaml`](examples/android/03_decoders/04_decoder_resolution.yaml).

Decoders never change the state of the object they decode. For example, frooky never reads the elements of an `Iterator`, which would use them up, and the decoders of `Cipher`, `Mac` and `Signature` never make them choose a provider early.

## Built-in Decoders

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

The spec decoders show a `byte[]` as hex and a `char[]` as text. `Cipher`, `Mac` and `Signature` choose their provider when they are initialized, depending on the key. Their decoders never make them choose one early, so they show the provider only once it is chosen. See [`01_java_types.yaml`](examples/android/03_decoders/01_java_types.yaml), [`02_android_types.yaml`](examples/android/03_decoders/02_android_types.yaml) and [`05_crypto_types.yaml`](examples/android/03_decoders/05_crypto_types.yaml).

## Named Decoders

With `decoder`, a parameter or return value is decoded with one of these registered decoders instead of the one frooky would pick:

- `string`: decodes a `byte[]` or `char[]` as text, or calls `toString()` on any other reference type
- `getters`: decodes an object through its public `get*()` and `is*()` methods, including inherited ones, e.g. an app class without a decoder
- `hashCode`: renders a reference type as `<class>@<hashCode>`, without invoking a custom `toString()` override
- `intentFlag`: decodes an `int` bitmask into the matching `Intent.FLAG_*` constant names
- `intentUriFlag`: decodes an `int` bitmask into the matching `Intent.URI_*` constant names
- `constant`: decodes a value into the name of the matching `static final` constant declared on the hooked method's own class (e.g. `1` -> `"ENCRYPT_MODE"` for `javax.crypto.Cipher`'s `opmode`), or of the `constants` you declare

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

With `constants`, the `constant` decoder uses the names you declare instead of the constants of the hooked class. This helps when the constants are declared on another class than the one you hook, e.g. an app's own wrapper around `Cipher`, or when the app is obfuscated and its fields have no meaningful names:

```yaml
javaClass: org.example.CryptoHelper
hooks:
  - method: process
    overloads:
      - params:
        - [int, mode, { decoder: constant, constants: { ENCRYPT_MODE: 1, DECRYPT_MODE: 2 } }]
        - ["[B", data]
```

The value is compared as a number, so `constants` only matches numeric values (`int`, `long`, `short`, `byte`, `float`, `double`). An `int` is compared as 32 bits, so a constant can be written in hex, e.g. `0x80000000` for `-2147483648`. A value without a constant is decoded as the value itself; frooky doesn't fall back to the constants of the hooked class.

See [`03_custom_decoders.yaml`](examples/android/03_decoders/03_custom_decoders.yaml).

## `direction`: Output Parameters

[`MessageDigest.digest(byte[], int, int)`](<https://developer.android.com/reference/java/security/MessageDigest#digest(byte[],%20int,%20int)>) computes the hash and writes it into `buf`, so `buf` must be decoded at exit:

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

See [`02_output_parameters.yaml`](examples/android/02_parameters_and_return_values/02_output_parameters.yaml).

## `decoderArg`

The Java decoders ignore `decoderArg`. A `byte[]` is decoded as a whole, up to `maxItems` bytes, also if a method only uses part of it, such as `Cipher.update(byte[] input, int inputOffset, int inputLen)`.

## Limits

What `maxItems` limits for each decoder, and whether it counts as a `maxDepth` level (see [`maxItems` and `maxDepth`](./decoders.md#maxitems-and-maxdepth-limit-large-and-nested-values)):

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

For `ContentValues`, whose output is a key/value object, the `"[truncated at N]"` marker is added as a key with the value `null`. Java strings, other values decoded with their `toString()`, and byte arrays decoded with `string` or `hex` end with `...` when they're cut.

```yaml
javaClass: android.content.Intent
hooks:
  - method: putExtras
    overloads:
      - params:
        - [ android.os.Bundle, extras, { maxItems: 20, maxDepth: 2 } ]
```

## Return Values

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
