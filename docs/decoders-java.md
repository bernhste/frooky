# Decoders for Android Java Hooks

How frooky decodes the parameters and return values of Java and Kotlin methods. The decoder settings, including the `decoderArgs` roles and the limits of each Java decoder, and the decoders shared with native hooks (`string`, `base64`, `hex`, `constants`, `bitmask`) are described in [Decoders](./decoders.md).

<!-- TOC -->

- [How frooky Picks a Java Decoder](#how-frooky-picks-a-java-decoder)
- [Class and Interface Decoders](#class-and-interface-decoders)
- [Java-Only Decoders](#java-only-decoders)
- [Return Values](#return-values)

<!-- /TOC -->

## How frooky Picks a Java Decoder

frooky picks the Java decoder by the object's runtime class, not by the type declared in the hook file. A parameter declared as `java.lang.Object` that receives a `HashMap` is decoded as a map. frooky uses the first of these that applies:

1. **`decoder` in the decoder settings.** A decoder you choose always wins. If it fails on a value, frooky logs a warning and decodes the value as if no `decoder` were set.
2. **A class decoder** for the runtime class or, if there is none, for its nearest superclass. `Intent` has one, so a `LabeledIntent`, a subclass of `Intent`, is decoded like an `Intent`.
3. **An interface decoder** for an interface the class implements, such as `java.util.Map` or `java.lang.Iterable`. If there are several, the most specific one wins: an interface that extends another one, e.g. `java.util.Collection` over `java.lang.Iterable`. If unrelated interfaces remain, e.g. a class that implements both `Map` and `Iterable`, the first one in frooky's list wins (`Map` before `Iterable`) and frooky logs a warning. Set `decoder` to choose another one.
4. **`toString()`** of the object.

Primitives, `java.lang.String` and arrays are decoded by their declared type. With `-v`, frooky logs which decoder it picked for each runtime class and why. See [`04_decoder_resolution.yaml`](examples/android/03_decoders/04_decoder_resolution.yaml).

Decoders never change the state of the object they decode. For example, frooky never reads the elements of an `Iterator`, which would use them up, and the decoders of `Cipher`, `Mac` and `Signature` never make them choose a provider early.

## Class and Interface Decoders

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

## Java-Only Decoders

Java hooks have the [shared decoders](./decoders.md#shared-decoders) `string`, `base64`, `hex`, `constants` and `bitmask`, and these two. See [`03_custom_decoders.yaml`](examples/android/03_decoders/03_custom_decoders.yaml).

### `getters`

`decoder: getters` decodes an object through its public `get*()` and `is*()` methods, including inherited ones, e.g. an app class without a decoder:

```yaml
javaClass: org.owasp.mastestapp.MastgTest
hooks:
  - method: receiveProfile
    overloads:
      - params:
          - [org.owasp.mastestapp.UserProfile, profile, { decoder: getters }]
```

This decodes `profile` as `[{ "name": "age", "value": 42 }, { "name": "name", "value": "alice" }, { "name": "admin", "value": true }]`, in the order of reflection. Each getter value is decoded one `maxDepth` level deeper.

### `hashCode`

`decoder: hashCode` renders an object as `<class>@<identity hash code in hex>`, like the default `Object.toString()`, without calling the object's own `toString()` or `hashCode()`:

```yaml
javaClass: org.owasp.mastestapp.MastgTest
hooks:
  - method: receiveBigInteger
    overloads:
      - params:
          - [java.math.BigInteger, number, { decoder: hashCode }]
```

This decodes `number` as `"java.math.BigInteger@<identity hash code in hex>"`. The identity hash code (`System.identityHashCode()`) is the [`hashCode`](./output.md) of the events about the same object, e.g. of a hooked method that returns `this`, so decoded values and events can be matched. It doesn't change while the object changes, and two distinct objects have different ones, even if they are equal. Hash codes can collide. Primitives and strings have no identity, they are decoded as if no `decoder` were set.

## Return Values

In Java, the method signature can be retrieved at runtime, so you never declare the return type itself. If you want to customize how the return value is decoded, add a `retType` object containing only `decoderSettings` to the overload:

```yaml
javaClass: android.content.Intent
hooks:
  - method: getFlags
    overloads:
      - params: []
        retType: { decoder: bitmask, config: { fields: "FLAG_*" } }
```

This example hooks the following method from the [Android Java Library](<https://developer.android.com/reference/android/content/Intent#getFlags()>):

```java
public int getFlags ()
```

`getFlags()` returns a raw bitmask `int`. Instead of reporting the raw number, the return value is decoded with `decoder: bitmask` to the names of the `Intent.FLAG_*` constants set in it, see [`constants` and `bitmask`](./decoders.md#constants-and-bitmask-decode-named-constants).
