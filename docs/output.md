# Output Format

frooky writes captured events to the file given via `-o`/`--output` (default `output.json`). Every 100ms, if any new events were captured since the last flush, frooky appends **one line containing a JSON array of that batch's events** — not one event object per line. Use `jq -c '.[]' output.json` to flatten the file into one event object per line, or `jq . output.json` to pretty-print it.

<!-- TOC -->

- [Common Event Fields](#common-event-fields)
- [`hook-java` Events](#hook-java-events)
- [`hook-native` Events](#hook-native-events)
- [`log` Events](#log-events)

<!-- /TOC -->

There are three kinds of events, distinguished by their `type` field: `hook-java`, `hook-native`, and `log` (for frooky related logging).

## Common Event Fields

Every event carries these fields:

| Field       | Type     | Description                                 |
| ----------- | -------- | ------------------------------------------- |
| `id`        | `string` | Unique identifier for the event (UUID).     |
| `timestamp` | `string` | Event timestamp in ISO 8601 format.         |
| `type`      | `string` | Type of the event.                          |

Hook events additionally carry:

| Field         | Type             | Description                                                                                                    |
| ------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `stackTrace`  | `string[]`       | Captured stack trace leading to the hooked call, subject to `hookSettings.stackTraceLimit`/`stackTraceFilter`. |
| `argsIn`      | `DecodedValue[]` | Arguments decoded on entry (`direction: in`/`inout`).                                                          |
| `argsOut`     | `DecodedValue[]` | Arguments decoded on exit (`direction: out`/`inout`).                                                          |
| `returnValue` | `DecodedValue`   | The decoded return value.                                                                                      |

A `DecodedValue` (used for each `argsIn`/`argsOut` entry and for `returnValue`) has the shape:

```json
{ "type": "<declared type>", "name": "<parameter name, if any>", "value": "<decoded value>" }
```

`name` is only present for named parameters (see [Parameter Declaration](./parameter-declaration.md)). `value`'s JSON type depends on the decoded type (string, number, boolean, array, object, or a stringified value for types like 64-bit integers that don't fit a JS `number`).

## `hook-java` Events

In addition to the [common fields](#common-event-fields), `hook-java` events carry:

| Field           | Type     | Description                                                                                                                                                                      |
| --------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `javaClassName` | `string` | The hooked Java/Kotlin class.                                                                                                                                                    |
| `method`        | `string` | The hooked method name.                                                                                                                                                          |
| `fieldType`     | `object` | `{ "fieldType": "static" \| "instance", "instanceId"?: number }`. `instanceId` is only present for `"instance"` calls (identifies the object instance the method was called on). |

**Example:**

```json
{
  "id": "0929f0ce-2701-429e-aa19-30bd99c272db",
  "timestamp": "2026-09-14T14:19:02.635Z",
  "type": "hook-java",
  "javaClassName": "org.owasp.mastestapp.MastgTest",
  "method": "receiveString",
  "fieldType": { "fieldType": "static" },
  "stackTrace": [
    "org.owasp.mastestapp.MastgTest.receiveString (MastgTest.kt:-1)",
    "org.owasp.mastestapp.MastgTest.mastgTest (MastgTest.kt:98)"
  ],
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

| Field    | Type     | Description                      |
| -------- | -------- | -------------------------------- |
| `module` | `string` | The hooked native module's name. |
| `symbol` | `string` | The hooked native symbol's name. |

**Example:**

```json
{
  "id": "8309092a-850c-4951-92b6-3440447440d0",
  "timestamp": "2026-09-14T14:43:57.333Z",
  "type": "hook-native",
  "module": "libreceiveFundamentalReference.so",
  "symbol": "reverse_byte_array",
  "stackTrace": [
    "Java_org_owasp_mastestapp_MastgTest_receiveFundamentalReferenceJNI+0x234 (libreceiveFundamentalReference.so:0x763e4c3a33b4)",
    "art_quick_generic_jni_trampoline+0xdc (libart.so:0x763e51a2b5ec)",
    "art_quick_invoke_stub+0x2f5 (libart.so:0x763e51a12155)",
    "org.owasp.mastestapp.MastgTest.receiveFundamentalReferenceJNI (MastgTest.kt:-2)",
    "org.owasp.mastestapp.MastgTest.mastgTest (MastgTest.kt:22)"
  ],
  "argsIn": [
    {
      "type": "unsigned char *",
      "name": "data",
      "value": ["0x57656c636f6d65204f57415350204d4153436f6e", "Welcome OWASP MASCon"]
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
      "value": ["0x6e6f4353414d20505341574f20656d6f636c6557", "noCSAM PSAWO emocleW"]
    }
  ]
}
```

Notes on this example:

- `stackTrace` is truncated above for brevity; a real trace also includes the app-side Kotlin frames that led to the native call.
- Buffer/pointer types like `unsigned char *` decode to a two-element `[rawHexBytes, interpretedString]` array rather than a plain scalar.
- `reverse_byte_array` returns `unsigned char *`, but since no `retType` was declared on this hook, no `returnValue` field is present — it's only included when the hook declares a decodable return type (see [`retType`](./native-hook-declaration.md)).

## `log` Events

frooky's internal log messages are routed into the output stream (alongside hook events) when frooky's `logTo` setting is set to `eventlog`. In addition to the [common fields](#common-event-fields), `log` events carry:

| Field   | Type     | Description                                            |
| ------- | -------- | ------------------------------------------------------ |
| `level` | `string` | `"none"`, `"error"`, `"warn"`, `"info"`, or `"debug"`. |
| `msg`   | `string` | The log message.                                       |

> [!TIP]
> Pass `-e`/`--print-events` to `frooky` to also pretty-print each `hook-java`/`hook-native` event to the terminal as it's captured, in addition to writing it to the output file.
>
> If you want to be fancy, you could even visualize them on a time line using tools like [Grafana](https://grafana.com/docs/grafana/latest/visualizations/simplified-exploration/logs/) or [Kibana](https://www.elastic.co/kibana) from the ELK-Stack — feed them the flattened, one-event-per-line output of `jq -c '.[]' output.json`.
