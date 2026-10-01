# Hook File Examples

Each folder shows one topic, for Java hooks in [`android/`](./android/) and for native hooks in [`native/`](./native/). The examples hook the target apps in [`tests/target-apps/android`](../../tests/target-apps/android), and each file documents the events it produces in its `# Expected` comments. [`tests/integration/android/test_examples.py`](../../tests/integration/android/test_examples.py) runs every example against the apps and checks these events.

To run an example, install the target app and press "Start" in it after frooky reports `Hooks ready`:

```sh
cd tests/target-apps/android && make build install TARGET_APP=value-passing-java && cd -
frooky -U -f value_passing_java.frooky.target.app docs/examples/android/01_basic_hooking/01_hook_by_name.yaml -e
```

| Topic                        | Android (Java)                                                                                                 | Native                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic hooking                | By name, select overloads, constructors and static methods                                                     | By symbol, by offset                                                                                                                                                    |
| Parameters and return values | Named parameters, output parameters (`direction`), return values                                               | Values and pointers, output parameters (`direction`), return values                                                                                                     |
| Decoders                     | Java types, Android types (Intent, Bundle, ...), custom decoders (`decoder`), decoder resolution, crypto types | Strings and buffers (`decoderArgs`, `decoder: string`), pointers and arrays (`decoder: nullTerminated`), file descriptors (`decoder: fd`), flags and enums (`constants`) |
| Decoder settings             | `maxItems`, `maxDepth`, `argFilter`                                                                            | `maxItems`, `argFilter`                                                                                                                                                 |
| Hook settings                | Platform stack trace, `stackTraceFilter`                                                                       | Native and platform stack traces, `stackTraceFilter`, low-level functions such as `open`                                                                                |
| Settings precedence          | Default, file, hook collection, hook, parameter/return type                                                    | Same                                                                                                                                                                    |
| Multiple hooks               | Several hooks on one method                                                                                    | Several hooks on one function                                                                                                                                           |
| Early hooking                | Spawn (`-f`) vs. attach                                                                                        | Spawn (`-f`) vs. attach, late-loaded libraries                                                                                                                          |
| Custom scripts               | -                                                                                                              | Load your own Frida script with `-l` (crash report)                                                                                                                     |

The folders are numbered in reading order: `01_basic_hooking`, `02_parameters_and_return_values`, `03_decoders`, `04_decoder_settings`, `05_hook_settings`, `06_settings_precedence`, `07_multiple_hooks`, `08_early_hooking` and `09_custom_scripts`.

`api_examples.yaml` in each platform folder hooks real Android and library APIs, such as `javax.crypto.Cipher` or libc's `read`. Use them as a starting point for your own hook files; they are not run by the tests.
