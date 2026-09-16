# Frooky

```txt
   ___    ____
  / __\  / _  |    _     _    _  _   _   _
 / _\   | (_) |  / _ \ / _ \ | / /  | | | |
/ /     / / | | | (_) | (_) ||  <   | |_| |
\/     /_/  |_|  \___/ \___/ |_|\_\  \__, |
                                     |___/
```

`frooky` is a [Frida](https://www.frida.re/)-based dynamic analysis tool for Android and iOS apps based on YAML hook files.

![PyPI - Version](https://img.shields.io/pypi/v/frooky?color=fuchsia) [![Test](https://github.com/cpholguera/frooky/actions/workflows/test.yml/badge.svg)](https://github.com/cpholguera/frooky/actions/workflows/test.yml)

- Hook Java/Kotlin methods and native C/C++ functions
- Simple YAML hook file format
- Support for method overloads and stack trace capture
- Argument capture with various data types
- Return value capture with various data types
- Filter hooks by argument values or stack trace patterns
- Output events in JSON Lines format for easy processing

Use it, if you know what you want to hook but you don't want to write custom Frida scripts or copy and paste them together. For example you can use it to quickly hook functions or methods based on public API documentation and quickly get insight about them.

> [!NOTE]
>
> This documentation describes the intended feature set for [frooky 1.0](https://github.com/cpholguera/frooky/milestone/1). At the time of writing this document, not all described features may have been fully implemented and there may be breaking changes to the hook file API until the release of frooky 1.0.
>
> [Feedback](https://github.com/cpholguera/frooky/discussions) is always welcome.

## Installation

Simply install via pip to get the `frooky` CLI tool:

```bash
pip install frooky
```

## Usage

Create a hook file (e.g., `hooks.yaml`) with the functions and/or methods you want to hook.

If you are already familiar with Frida and function hooking, we recommend using the documented examples as a quick starting point. You find them in the folder [docs/examples/](./docs/examples/).

For more information, read all about the structure in chapter [Structure of a Hook File](#structure-of-a-hook-file).

After you created the desired hook file, run `frooky`:

```bash
# Attach by app name
frooky -U -n org.owasp.mastestapp hooks.yaml

# Spawn and load multiple hook files (hooks are merged)
frooky -U -f org.owasp.mastestapp storage.yaml crypto.yaml

# Spawn and load multiple hook files using globs (hooks are merged)
frooky -U -f org.owasp.mastestapp hooks_*.yaml
```

See `frooky -h` for more options.

## Structure of a Hook File

frooky uses _hook files_, which are structured YAML files including declarations of methods or functions to be hooked.

A hook file consists of optional metadata and a list of _hook declarations_ called `hookCollection` . The following YAML file describes the basic structure:

```yaml
metadata:                         # All metadata is optional
  name: <name>                    # Name of the hook collection
  platform: Android|iOS           # Target platform (hooks must be platform-specific)
  description: <description>      # Description of what the hook collection does
  category: <category>            # Category of the hook collection
  author: <author>                # Your name or organization
  version: <version>              # Version number of the hook collection (e.g., 1)

settings:                         # Optional. Default hookSettings/decoderSettings applied to every hook group
  hookSettings: { ... }
  decoderSettings: { ... }

hookCollection:                   # Collection of hook declarations
  - <hook_declaration>
```

## Hook Declaration

Depending on the platform, the `<hook_declaration>` may look different. Please read the linked platform-specific documentation for more information.

frooky supports these types of hooks:

| Hook Type    | Platform    | Description                                 | Documentation                                                 |
| ------------ | ----------- | ------------------------------------------- | ------------------------------------------------------------- |
| `JavaHook`   | Android     | Hook for Java/Kotlin methods                | [`JavaHook`-Declaration](./docs/java-hook-declaration.md)     |
| `NativeHook` | Android/iOS | Hook for native functions (C/C++/Rust etc.) | [`NativeHook`-Declaration](./docs/native-hook-declaration.md) |

> [!NOTE]
> `hookCollection` may freely mix different hook declarations within the same hook file, as long as they are compatible to the platform. For example an Android hook file with `JavaHook` and `NativeHook` is valid.

## Parameter- and Return-Type Declaration

frooky can decode data passed to functions or methods via arguments, including their return values.

Depending on the value types, this can be simple or more complex. frooky tries to decode arguments and return values by itself if possible. But in some cases, e.g. when the value is simply a pointer, it is necessary to provide information about the types used. Before writing a hook declaration, it is therefore recommended to read the following documentation:

- [Parameter Declaration](docs/parameter-declaration.md)
- [Return Type Declaration](docs/return-type-declaration.md)
- [Decoders](docs/decoders.md)

## Example

We'll use the OWASP MAS [MASTG-DEMO-0106](https://mas.owasp.org/MASTG/demos/android/MASVS-RESILIENCE/MASTG-DEMO-0106/MASTG-DEMO-0106/) app to demonstrate hooking a cryptographic en-/decryption method.

First you need to create a hook file, e.g., `cipher.yaml`:

```yaml
metadata:
  name: Android Cipher doFinal Hook
  platform: Android
  description: Captures the plaintext/ciphertext passed to Cipher#doFinal during en-/decryption decoded as string.
  category: CRYPTO
  author: frooky dev team
  version: 1

hookCollection:
  - javaClass: javax.crypto.Cipher
    hooks:
      - [ doFinal, {decoder: "string"} ]
```

Then run `frooky` with the hook file against your target app:

```bash
frooky -U -f org.owasp.mastestapp cipher.yaml
```

Events are written to the output file as newline-separated batches, each line a JSON array of the events captured in that batch (see [Understanding Output Format](./docs/output.md) for the full schema).

Example Output (pretty-printed for readability):

```json
{
    "id": "0a6c400a-a7fe-44ab-8842-d1e4a67e0487",
    "timestamp": "2026-09-16T06:20:33.163Z",
    "type": "hook-java",
    "javaClassName": "javax.crypto.Cipher",
    "method": "doFinal",
    "fieldType": {
        "fieldType": "static"
    },
    "stackTrace": [
      "javax.crypto.Cipher.doFinal (Cipher.java:2066)",
      "org.owasp.mastestapp.MastgTest.mastgTest (MastgTest.kt:58)",
      "org.owasp.mastestapp.MainActivityKt.MainScreen$lambda$12$lambda$11 (MainActivity.kt:101)",
      "org.owasp.mastestapp.MainActivityKt.$r8$lambda$Pm6AsbKBmypP53K-UABM21E_Xxk (MainActivity.kt:-1)",
      "org.owasp.mastestapp.MainActivityKt$$ExternalSyntheticLambda3.run (D8$$SyntheticClass:0)"
    ],
    "argsIn": [
        {
            "type": "[B",
            "value": ".5}....!(.L;(...KY.ly.Pd.`2.uT.....x.C?."
        }
    ],
    "argsOut": [],
    "returnValue": {
        "type": "[B",
        "value": "We ❤️ OWASP MAS 📱"
    }
}
```

## More Information

Please refer to the following documentation for more information about various topics:

- [Additional Settings and Best Practices](./docs/additional-features.md)
- [Development / Local Testing](./docs/develop.md)
- [Understanding Output Format](./docs/output.md)
