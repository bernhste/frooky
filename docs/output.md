# Output Format

frooky writes captured events to the file given via `-o`/`--output` (default `output.json`).

<!-- TOC -->

- [Common Event Fields](#common-event-fields)
- [`hook-java` Events](#hook-java-events)
- [`hook-native` Events](#hook-native-events)
- [Printing Events to the Terminal](#printing-events-to-the-terminal)

<!-- /TOC -->

There are three kinds of events, distinguished by their `type` field: `hook-java`, `hook-native`, and `log` (for frooky related logging).

## Common Event Fields

Every event carries these fields:

| Field       | Type     | Description                             |
| ----------- | -------- | --------------------------------------- |
| `id`        | `string` | Unique identifier for the event (UUID). |
| `timestamp` | `string` | Event timestamp in ISO 8601 format.     |
| `type`      | `string` | Type of the event.                      |

Hook events additionally carry:

| Field         | Type             | Description                                                                                                                                                                                                                                                                                                                                      |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stackTrace`  | `object`         | Captured stack trace leading to the hooked call (`{ platformStackTrace: string[], nativeStackTrace: string[] }`), enabled via `hookSettings.platformStackTrace`/`nativeStackTrace` and limited by `maxStackFrames`. `skipped` names why requested frames are missing, see [Skipped Stack Traces](./additional-features.md#skipped-stack-traces). |
| `argsIn`      | `DecodedValue[]` | Arguments decoded on entry (`direction: in`/`inout`).                                                                                                                                                                                                                                                                                            |
| `argsOut`     | `DecodedValue[]` | Arguments decoded on exit (`direction: out`/`inout`).                                                                                                                                                                                                                                                                                            |
| `returnValue` | `DecodedValue`   | The decoded return value.                                                                                                                                                                                                                                                                                                                        |
| `hashCode`    | `string`         | A 32-bit hash code as hex, e.g. `c437358`. For Java hooks the instance's `System.identityHashCode()` (none for static methods), for native hooks a hash of the function's address. Events with the same `hashCode` are about the same object or function; hash codes can collide.                                                                |

A `DecodedValue` (used for each `argsIn`/`argsOut` entry and for `returnValue`) has the shape:

```json
{ "type": "<declared type>", "name": "<parameter name, if any>", "value": "<decoded value>" }
```

> [!TIP]
> Each line in `output.json` is a self-contained JSON event object (NDJSON). Use `jq -c '.' output.json` or `jq . output.json` to inspect or pretty-print individual events.
>
> If you want to visualize them on a time line using tools like [Grafana](https://grafana.com/docs/grafana/latest/visualizations/simplified-exploration/logs/) or [Kibana](https://www.elastic.co/kibana) from the ELK-Stack - feed them the one-event-per-line output directly.

## `hook-java` Events

In addition to the [common fields](#common-event-fields), `hook-java` events carry:

| Field           | Type     | Description                                                                     |
| --------------- | -------- | ------------------------------------------------------------------------------- |
| `javaClassName` | `string` | The hooked Java/Kotlin class.                                                   |
| `method`        | `string` | The hooked method name.                                                         |
| `fieldType`     | `object` | `{ "fieldType": "static" \| "instance" }`, whether the hooked method is static. |

**Example:**

```json
{
  "id": "0929f0ce-2701-429e-aa19-30bd99c272db",
  "timestamp": "2026-09-14T14:19:02.635Z",
  "type": "hook-java",
  "javaClassName": "org.owasp.mastestapp.MastgTest",
  "method": "receiveString",
  "fieldType": { "fieldType": "instance" },
  "stackTrace": {
    "platformStackTrace": [
      "org.owasp.mastestapp.MastgTest.receiveString (MastgTest.kt:-1)",
      "org.owasp.mastestapp.MastgTest.mastgTest (MastgTest.kt:98)"
    ],
    "nativeStackTrace": []
  },
  "argsIn": [
    {
      "type": "java.lang.String",
      "name": "receivedString",
      "value": "Welcome OWASP MASCon 📱❤️"
    }
  ],
  "argsOut": [],
  "returnValue": {
    "type": "void",
    "value": "void"
  }
}
```

## `hook-native` Events

In addition to the [common fields](#common-event-fields), `hook-native` events carry:

| Field     | Type     | Description                                                                                                                                                                            |
| --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `module`  | `string` | The hooked native module's name.                                                                                                                                                       |
| `symbol`  | `string` | The hooked native symbol's name. Only for hooks declared with `symbol`.                                                                                                                |
| `offset`  | `string` | The hooked function's offset from the module's base address, e.g. `0x1a2b4`. Only for hooks declared with [`offset`](./native-hook-declaration.md#hooking-functions-without-a-symbol). |
| `address` | `string` | The hooked function's address in the process, e.g. `0x763e4c3a2f10`.                                                                                                                   |

**Example:**

```json
{
  "id": "8309092a-850c-4951-92b6-3440447440d0",
  "timestamp": "2026-09-14T14:43:57.333Z",
  "type": "hook-native",
  "module": "libreceiveFundamentalReference.so",
  "symbol": "reverse_byte_array",
  "address": "0x763e4c3a2f10",
  "stackTrace": {
    "platformStackTrace": [
      "org.owasp.mastestapp.MastgTest.receiveFundamentalReferenceJNI (MastgTest.kt:-2)",
      "org.owasp.mastestapp.MastgTest.mastgTest (MastgTest.kt:22)"
    ],
    "nativeStackTrace": [
      "Java_org_owasp_mastestapp_MastgTest_receiveFundamentalReferenceJNI+0x234 (libreceiveFundamentalReference.so:0x763e4c3a33b4)",
      "art_quick_generic_jni_trampoline+0xdc (libart.so:0x763e51a2b5ec)",
      "art_quick_invoke_stub+0x2f5 (libart.so:0x763e51a12155)"
    ]
  },
  "argsIn": [
    {
      "type": "unsigned char *",
      "name": "data",
      "value": "Welcome OWASP MASCon"
    },
    {
      "type": "int",
      "name": "length",
      "value": 20
    }
  ],
  "argsOut": [
    {
      "type": "unsigned char *",
      "name": "data",
      "value": "noCSAM PSAWO emocleW"
    }
  ]
}
```

Notes on this example:

- `stackTrace` is truncated above for brevity; a real trace also includes the app-side Kotlin frames that led to the native call.
- Buffer/pointer `unsigned char *` was decoded using the built in `string` decoder.
- `reverse_byte_array` returns `unsigned char *`, but since no `retType` was declared on this hook, no `returnValue` field is present. It's only included when the hook declares a decodable return type (see [`retType`](./native-hook-declaration.md)).

## Printing Events to the Terminal

Pass `-e`/`--print-events` to `frooky` to also pretty-print each `hook-java`/`hook-native` event to the terminal as it's captured, in addition to writing it to the output file.

```sh
$ frooky -U -f value_passing_java.frooky.target.app docs/examples/android/01_basic_hooking/01_hook_by_name.yaml -e
   ___    ____                                Frooky v0.1.dev174+gc704d263c.d20260914
  / __\  / _  |    _     _    _  _   _   _
 / _\   | (_) |  / _ \ / _ \ | / /  | | | |   Frida host:   v17.18.0
/ /     / / | | | (_) | (_) ||  <   | |_| |   Frida device: v17.17.0
\/     /_/  |_|  \___/ \___/ |_|\_\  \__, |   Frida agent:  v17.18.0
                                     |___/
                                              Device: Android Emulator 5554 (emulator-5554)
                                              Target: org.owasp.mastestapp (spawned)

                                              Output:  output.json
                                              Runtime: QuickJS

  Press R to reload the hook files and retry failed hooks, I for hook statistics, Ctrl+C to stop...

┌─ java (static) ──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ time:         2026-09-16T20:24:24.094Z
│ class:        javax.crypto.Cipher
│ method:       init(int opmode, java.security.Key key, java.security.SecureRandom random)
│
│ arguments in:
│     int opmode
│       'ENCRYPT_MODE'
│     java.security.Key key
│       'android.security.keystore2.AndroidKeyStoreSecretKey@fe4744ec'
│     java.security.SecureRandom random
│       'OpenSSLRandom'
│
│ returns:
│     void
│
│ stack trace:  javax.crypto.Cipher.init (Cipher.java:1158)
│               javax.crypto.Cipher.init (Cipher.java:1103)
│               org.owasp.mastestapp.MastgTest.mastgTest (MastgTest.kt:46)
│               org.owasp.mastestapp.MainActivityKt.MainScreen$lambda$12$lambda$11 (MainActivity.kt:101)
│               org.owasp.mastestapp.MainActivityKt.$r8$lambda$Pm6AsbKBmypP53K-UABM21E_Xxk (MainActivity.kt:-1)
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌─ java (static) ──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ time:         2026-09-16T20:24:24.095Z
│ class:        javax.crypto.Cipher
│ method:       doFinal([B)
│
│ arguments in:
│     [B
│       'We ❤️ OWASP MAS 📱'
│
│ returns:
│     [B
│       ';.\tX..V\\F..=.RT+-nwEob_.2..=.."J........'
│
│ stack trace:  javax.crypto.Cipher.doFinal (Cipher.java:2066)
│               org.owasp.mastestapp.MastgTest.mastgTest (MastgTest.kt:48)
│               org.owasp.mastestapp.MainActivityKt.MainScreen$lambda$12$lambda$11 (MainActivity.kt:101)
│               org.owasp.mastestapp.MainActivityKt.$r8$lambda$Pm6AsbKBmypP53K-UABM21E_Xxk (MainActivity.kt:-1)
│               org.owasp.mastestapp.MainActivityKt$$ExternalSyntheticLambda3.run (D8$$SyntheticClass:0)
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
