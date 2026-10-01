---
name: update-native-offsets
description: Use after changing or rebuilding a native target app (e.g. editing tests/target-apps/android/value-passing-native/cpp/*.c), or when frooky skips an example's `offset:` hook with "The offset points into the section ...". Updates the hardcoded function offsets in docs/examples to the current build.
---

# Updating native offsets in the examples

Hooks declared with `offset:` only fit one build of a library. Any change to a target app's C code moves its functions, and the examples then hook into data sections, which frooky rejects. No test catches this: `test_examples.py` skips these files and `test_hook_by_offset` looks its offset up at runtime.

The offsets are for the **x86_64** build, the ABI of the CI emulator.

## Files with offsets

Find them with `grep -rn "offset:" docs/examples`. Skip `docs/examples/native/api_examples.yaml`: its `libfoo.so` offsets are placeholders.

Current files:

- `docs/examples/native/01_basic_hooking/02_hook_by_offset.yaml`: `receive_int` and `receive_short` in `libreceiveFundamentalValue.so`. Also update the offsets in its `# Expected` comment.
- `docs/examples/native/09_custom_scripts/01_crash.yaml`: `receive_cstring` and `receive_utf8` in `libreceiveString.so`, plus one offset that must lie in `.rodata` so frooky rejects it.

Each offset hook names its function in a comment next to it. Keep that so the next update knows which symbol to look up.

## Workflow

1. Rebuild and install the app: `cd tests/target-apps/android && make install TARGET_APP=<app>`.
2. Read the symbol offsets and section ranges from the build:

   ```bash
   LIB=tests/target-apps/android/<app>/build/app/build/intermediates/stripped_native_libs/debug/stripDebugDebugSymbols/out/lib/x86_64/<lib>.so
   nm -D --defined-only $LIB          # function offsets
   readelf -SW $LIB                   # section ranges, e.g. for the .rodata offset
   readelf -p .rodata $LIB            # pick an offset at the start of a string
   ```

3. Update every offset and any comment that repeats it (`# Expected`, "0x... lies in .rodata"). Keep the format of each value. A quoted hex string such as `"0x00000000000013C0"` stays a 16-digit uppercase string, because it shows the string form.
4. If a device is available, check that the installed app matches the build by reading the offsets from the running process, e.g. with `Process.getModuleByName(m).getExportByName(s).sub(m.base)`. Then run the example with `frooky` and confirm the hooks resolve: the status line shows no `not resolved` beyond the deliberately rejected ones.
