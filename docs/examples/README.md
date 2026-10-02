# Hook File Examples

Each folder shows one topic, for Java hooks in [`android/`](./android/) and for native hooks in [`native/`](./native/). The examples hook the target apps in [`tests/target-apps/android`](../../tests/target-apps/android), and each file documents the events it produces in its `# Expected` comments. [`tests/integration/android/test_examples.py`](../../tests/integration/android/test_examples.py) runs every example against the apps and checks these events.

To run an example, install the target app and press "Start" in it after frooky reports `Hooks ready`:

```sh
cd tests/target-apps/android && make build install TARGET_APP=value-passing-java && cd -
frooky -U -f value_passing_java.frooky.target.app docs/examples/android/01_basic_hooking/01_hook_by_name.yaml -e
```

| Topic                        | Android (Java)                                                                                                          | Native                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic hooking                | By name, select overloads, constructors and static methods, custom class loaders (`classLoader`)                        | By symbol, by offset                                                                                                                                                                      |
| Parameters and return values | Named parameters, output parameters (`direction`), return values                                                        | Values and pointers, output parameters (`direction`), return values                                                                                                                       |
| Decoders                     | Java types, Android types (Intent, Bundle, ...), custom decoders (`decoder`, `flags`), decoder resolution, crypto types | Strings, UTF-16 and buffers (`decoderArgs`, `decoder: string`), pointers and arrays (`decoder: nullTerminated`), file descriptors (`decoder: fd`), flags and enums (`constants`), `errno` |
| Decoder settings             | `maxItems`, `maxDepth`, `argFilter`, `decoderArgs`                                                                      | `maxItems`, `argFilter`                                                                                                                                                                   |
| Hook settings                | Platform stack trace, `callerFilter`                                                                                    | Native and platform stack traces, `callerFilter`, low-level functions such as `open`                                                                                                      |
| Settings precedence          | Default, file, hook collection, hook, parameter/return type                                                             | Same                                                                                                                                                                                      |
| Multiple hooks               | Several hooks on one method                                                                                             | Several hooks on one function                                                                                                                                                             |
| Early hooking                | Spawn (`-f`) vs. attach                                                                                                 | Spawn (`-f`) vs. attach, late-loaded libraries                                                                                                                                            |
| Custom scripts               | -                                                                                                                       | Load your own Frida script with `-l` (crash report)                                                                                                                                       |
| Torture                      | Hot framework methods, re-entrancy through decoders, deep stack traces (levels 1-5)                                     | Hot libc, re-entrancy through decoders, stack traces on libc, allocator and locks (levels 1-5)                                                                                            |

The folders are numbered in reading order: `01_basic_hooking`, `02_parameters_and_return_values`, `03_decoders`, `04_decoder_settings`, `05_hook_settings`, `06_settings_precedence`, `07_multiple_hooks`, `08_early_hooking` and `09_custom_scripts`.

`99_torture` is not a tutorial: its levels 1 to 5 put more and more load on frooky and the app, to check the guardrails, find crashes and measure how many events/s the app can take. They have no fixed expected events and are not run by the tests; each file says what to watch. The native level 5 also comes filtered (`05_level_5_filtered.yaml`), as the part of it that the app survives.

`api_examples.yaml` in each platform folder hooks real Android and library APIs, such as `javax.crypto.Cipher` or libc's `read`. Use them as a starting point for your own hook files; they are not run by the tests.
