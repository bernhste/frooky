import { DEFAULT_BASE_DECODER_SETTINGS, DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { InputJavaHookCollection } from "../../shared/inputParsing/inputJavaHookCollection";
import { InputNativeHookCollection, InputNativeHookDetails } from "../../shared/inputParsing/inputNativeHookCollection";
import { logger } from "../../shared/logger";
import { NativeHookValidator } from "./nativeHookValidator";

const defaultSettings: FrookySettings = {
  hookSettings: { ...DEFAULT_HOOK_SETTINGS },
  decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS },
};

describe("NativeHookValidator", () => {
  const validator = new NativeHookValidator();

  describe("getPlatformHookCollections()", () => {
    it("returns an empty array for an empty hookCollection list", () => {
      const config: InputFrookyConfig = { hookCollections: [] };
      expect(validator.getPlatformHookCollections(config)).toEqual([]);
    });

    it("returns only the native hook collections from a mixed hookCollection list, preserving order", () => {
      const nativeCollectionA: InputNativeHookCollection = { module: "libc.so", hooks: [] };
      const javaCollection: InputJavaHookCollection = { javaClass: "com.example.A", hooks: [] };
      const nativeCollectionB: InputNativeHookCollection = { module: "libssl.so", hooks: [] };
      const config: InputFrookyConfig = {
        hookCollections: [nativeCollectionA, javaCollection, nativeCollectionB] as unknown as InputNativeHookCollection[],
      };

      expect(validator.getPlatformHookCollections(config)).toEqual([nativeCollectionA, nativeCollectionB]);
    });

    it("returns an empty array when there are no native hook collections", () => {
      const javaCollection: InputJavaHookCollection = { javaClass: "com.example.A", hooks: [] };
      const config: InputFrookyConfig = { hookCollections: [javaCollection] as unknown as InputNativeHookCollection[] };

      expect(validator.getPlatformHookCollections(config)).toEqual([]);
    });
  });

  describe("validateAndNormalizeHooks()", () => {
    let warnSpy: Mock;
    // the warning for a skipped hook
    const skipWarning = () => warnSpy.mock.calls.map((call) => String(call[0])).find((message) => message.startsWith("Skipping hook")) ?? "";

    beforeEach(() => {
      warnSpy = spyOn(logger, "warn");
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("returns an empty array when the config has no native hook collections", () => {
      const config: InputFrookyConfig = { hookCollections: [] };
      expect(validator.validateAndNormalizeHooks(config, defaultSettings)).toEqual([]);
    });

    it("normalizes a plain symbol-name hook into a full NativeHookDeclaration", () => {
      const nativeCollection: InputNativeHookCollection = { module: "libfoo.so", hooks: ["custom_func"] };
      const config: InputFrookyConfig = { hookCollections: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result).toEqual([
        { symbol: "custom_func", module: "libfoo.so", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_BASE_DECODER_SETTINGS },
      ]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    for (const [kind, hooks] of [
      ["a string", "custom_func"],
      ["missing", undefined],
    ]) {
      it(`skips a collection whose hooks are ${kind}`, () => {
        const nativeCollection = { module: "libfoo.so", hooks } as unknown as InputNativeHookCollection;
        const otherCollection: InputNativeHookCollection = { module: "libbar.so", hooks: ["funcB"] };
        const config: InputFrookyConfig = { hookCollections: [nativeCollection, otherCollection] };

        const result = validator.validateAndNormalizeHooks(config, defaultSettings);

        expect(result.map((hook) => hook.symbol)).toEqual(["funcB"]);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0][0])).toContain("Skipping the hook collection for module 'libfoo.so': 'hooks' must be a list");
      });
    }

    it("collects hooks from multiple native hook collections, ignoring non-native hook collections", () => {
      const nativeCollectionA: InputNativeHookCollection = { module: "libfoo.so", hooks: ["funcA"] };
      const javaCollection: InputJavaHookCollection = { javaClass: "com.example.A", hooks: ["foo"] };
      const nativeCollectionB: InputNativeHookCollection = { module: "libssl.so", hooks: ["SSL_write"] };
      const config: InputFrookyConfig = {
        hookCollections: [nativeCollectionA, javaCollection, nativeCollectionB] as unknown as InputNativeHookCollection[],
      };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["funcA", "SSL_write"]);
    });

    it("skips a hook collection and a hook with an unknown property or the settings of a single parameter", () => {
      const collections = [
        { module: "libfoo.so", decoderSettings: { argFilter: ["^x"] }, hooks: ["skippedA"] },
        { module: "libfoo.so", hookSetings: {}, hooks: ["skippedB"] },
        {
          module: "libfoo.so",
          hooks: [{ symbol: "funcA", decoderSettings: { maxItems: 3, length: 4 } }, ["funcB", { decoder: "fd", argFilter: ["^b"] }], "funcC"],
        },
      ] as unknown as InputNativeHookCollection[];

      const hooks = validator.validateAndNormalizeHooks({ hookCollections: collections }, defaultSettings);

      expect(hooks.map((hook) => hook.symbol)).toEqual(["funcC"]);
      const messages = warnSpy.mock.calls.map(([message]) => message as string);
      expect(messages).toContain(
        "Skipping the hook collection for module 'libfoo.so': The hook collection contains unknown properties: decoderSettings.argFilter",
      );
      expect(messages).toContain("Skipping the hook collection for module 'libfoo.so': The hook collection contains unknown properties: hookSetings");
      expect(messages).toContain(
        "Skipping hook for native function 'funcA' from module 'libfoo.so' due to an invalid declaration:\nThe hook contains unknown properties: decoderSettings.length",
      );
      expect(messages).toContain(
        "Skipping hook for native function 'funcB' from module 'libfoo.so' due to an invalid declaration:\nThe hook contains unknown properties: [1].argFilter",
      );
    });

    it("skips a hook collection whose module is a path", () => {
      const collection: InputNativeHookCollection = { module: "/apex/com.android.runtime/lib64/bionic/libc.so", hooks: ["free"] };

      expect(validator.validateAndNormalizeHooks({ hookCollections: [collection] }, defaultSettings)).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        "Skipping the hook collection for module '/apex/com.android.runtime/lib64/bionic/libc.so': 'module' must be the file name of the module, e.g. 'libc.so', not a path.",
      );
    });

    it("skips a hook with a type that is no C type, a name that is no identifier or an invalid argFilter", () => {
      const collection = {
        module: "libc.so",
        hooks: [
          { symbol: "a", params: [["java.lang.String", "text"]] },
          { symbol: "b", returns: "[B" },
          { symbol: "c", params: [["int", "$ret"]] },
          { symbol: "d", params: [["const char *", "path", { argFilter: ["("] }]] },
          { symbol: "e", params: [["int", "fd", { argFilter: ["> 5 < 10"] }]] },
          {
            symbol: "ok",
            returns: "ssize_t",
            params: [
              ["const char *", "path", { argFilter: ["^/data/"] }],
              ["size_t", "count", { argFilter: ["> 16"] }],
            ],
          },
        ],
      } as unknown as InputNativeHookCollection;

      const hooks = validator.validateAndNormalizeHooks({ hookCollections: [collection] }, defaultSettings);

      expect(hooks.map((hook) => hook.symbol)).toEqual(["ok"]);
      const messages = warnSpy.mock.calls.map(([message]) => message as string);
      expect(messages.length).toBe(5);
      expect(messages[0]).toContain("'java.lang.String' as the type of 'text' is no C type.");
      expect(messages[1]).toContain("'[B' as a type is no C type.");
      expect(messages[2]).toContain("Skipping hook for native function 'c' from module 'libc.so' due to an invalid declaration:");
      expect(messages[3]).toContain("argFilter of 'path': '(' is no regular expression:");
      expect(messages[4]).toContain("argFilter of 'fd': '> 5 < 10' is no numeric comparison.");
    });

    it("accepts decoderOptions.constants for the constants and bitmask decoders, and rejects it for a preset and other decoders", () => {
      const nativeCollection: InputNativeHookCollection = {
        module: "libfoo.so",
        hooks: [
          {
            symbol: "ok",
            params: [["int", "mode", { decoder: "constants", decoderOptions: { constants: { A: 1 } } }]],
            returns: ["int", { decoder: "bitmask", decoderOptions: { constants: { B: 2 } } }],
          },
          { symbol: "preset", params: [["int", "flags", { decoder: "openFlags", decoderOptions: { constants: { A: 1 } } }]] },
          { symbol: "fd", params: [["int", "fd", { decoder: "fd", decoderOptions: { constants: { A: 1 } } }]] },
        ],
      };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["ok"]);
      const messages = warnSpy.mock.calls.map(([message]) => message as string);
      expect(messages[0]).toContain("decoderOptions of 'flags': decoder 'openFlags' doesn't accept 'constants'. It accepts no decoderOptions.");
      expect(messages[1]).toContain("decoderOptions of 'fd': decoder 'fd' doesn't accept 'constants'. It accepts no decoderOptions.");
    });

    it("skips a hook with decoderOptions.class or decoderOptions.fields, which only Java hooks support", () => {
      const nativeCollection = {
        module: "libfoo.so",
        hooks: [
          "ok",
          { symbol: "bad", params: [["int", "flags", { decoder: "bitmask", decoderOptions: { class: "android.os.Foo", fields: "FLAG_*" } }]] },
        ],
      } as unknown as InputNativeHookCollection;

      const result = validator.validateAndNormalizeHooks({ hookCollections: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["ok"]);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("decoderOptions of 'flags': decoder 'bitmask' doesn't accept 'class', 'fields'. It accepts: constants.");
    });

    it("skips a hook that sets a module itself", () => {
      const nativeCollection: InputNativeHookCollection = {
        module: "libfoo.so",
        hooks: [{ symbol: "funcA", module: "libwrong.so" } as InputNativeHookDetails, "funcB"],
      };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => [hook.module, hook.symbol])).toEqual([["libfoo.so", "funcB"]]);
      expect(skipWarning()).toContain("The hook contains unknown properties: module");
    });

    it("normalizes params and returns using the merged decoder settings", () => {
      const nativeCollection: InputNativeHookCollection = {
        module: "libfoo.so",
        hooks: [{ symbol: "custom_func", params: ["void *", "void *", "size_t"], returns: "void *" }],
      };
      const config: InputFrookyConfig = { hookCollections: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result[0].params).toEqual([
        { type: "void *", direction: "in", settings: DEFAULT_DECODER_SETTINGS },
        { type: "void *", direction: "in", settings: DEFAULT_DECODER_SETTINGS },
        { type: "size_t", direction: "in", settings: DEFAULT_DECODER_SETTINGS },
      ]);
      expect(result[0].returns).toEqual({ type: "void *", settings: DEFAULT_DECODER_SETTINGS });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("skips a hook that fails schema validation, warns about it, and still keeps the valid hooks", () => {
      const invalidHook = { symbol: 123 as unknown as string };
      const nativeCollection: InputNativeHookCollection = {
        module: "libc.so",
        hooks: ["validSymbol", invalidHook],
      };
      const config: InputFrookyConfig = { hookCollections: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["validSymbol"]);
      expect(warnSpy).toHaveBeenCalled();
      const message = skipWarning();
      expect(message).toContain("Skipping hook for native function '123' from module 'libc.so' due to an invalid declaration:");
    });

    it("normalizes a offset hook written as an unquoted YAML hex number", () => {
      const nativeCollection: InputNativeHookCollection = { module: "libfoo.so", hooks: [{ offset: 0x1a2b4 }] };
      const config: InputFrookyConfig = { hookCollections: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.offset)).toEqual(["0x1a2b4"]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("skips a hook with an invalid offset and names the offset in the warning", () => {
      const nativeCollection: InputNativeHookCollection = {
        module: "libfoo.so",
        hooks: ["validSymbol", { offset: "1a2b4" }],
      };
      const config: InputFrookyConfig = { hookCollections: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["validSymbol"]);
      const message = skipWarning();
      expect(message).toContain("Skipping hook for native function at offset '1a2b4' from module 'libfoo.so'");
    });

    it("skips a hook with both a symbol and an offset", () => {
      const bothHook = { symbol: "foo", offset: "0x1a2b4" } as unknown as InputNativeHookDetails;
      const nativeCollection: InputNativeHookCollection = { module: "libfoo.so", hooks: ["validSymbol", bothHook] };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["validSymbol"]);
      expect(skipWarning()).toContain("Skipping hook for native function 'foo' from module 'libfoo.so' due to an invalid declaration:");
    });

    it("skips an offset hook in a module wildcard pattern and keeps its symbol hooks", () => {
      const nativeCollection: InputNativeHookCollection = { module: "libfoo*.so", hooks: ["validSymbol", { offset: "0x1a2b4" }] };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => [hook.module, hook.symbol])).toEqual([["libfoo*.so", "validSymbol"]]);
      expect(skipWarning()).toContain("'offset' needs an exact module name, not the pattern 'libfoo*.so'");
    });

    it("skips a hook with an invalid hook setting", () => {
      const invalidHook = { symbol: "foo", hookSettings: { maxStackFrames: -1 } };
      const nativeCollection: InputNativeHookCollection = { module: "libfoo.so", hooks: ["validSymbol", invalidHook] };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["validSymbol"]);
      expect(skipWarning()).toContain("hookSettings.maxStackFrames");
    });

    it("skips a hook whose param declaration is in an unrecognized format, without aborting the rest of the collection", () => {
      const invalidParamHook = { symbol: "bad", params: [123 as unknown as string] };
      const nativeCollection: InputNativeHookCollection = {
        module: "libc.so",
        hooks: ["free", invalidParamHook, "malloc"],
      };
      const config: InputFrookyConfig = { hookCollections: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["free", "malloc"]);
      expect(warnSpy).toHaveBeenCalled();
      const message = skipWarning();
      expect(message).toContain("Skipping hook for native function 'bad' from module 'libc.so' due to an invalid declaration:");
    });

    it("skips a hook whose length does not name another param", () => {
      const writeHook: InputNativeHookDetails = {
        symbol: "write",
        params: ["int", ["const void *", "buf", { length: "count", decoder: "string" }], "size_t"],
      };
      const nativeCollection: InputNativeHookCollection = { module: "libc.so", hooks: ["free", writeHook] };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["free"]);
      const message = skipWarning();
      expect(message).toContain("Skipping hook for native function 'write'");
      expect(message).toContain("'length: count' of 'buf' names no parameter");
    });

    it("skips a hook with decoder: errno on a param", () => {
      const unlinkHook: InputNativeHookDetails = {
        symbol: "unlink",
        params: [["const char *", "path", { decoder: "errno" }]],
      };
      const nativeCollection: InputNativeHookCollection = { module: "libc.so", hooks: ["free", unlinkHook] };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["free"]);
      const message = skipWarning();
      expect(message).toContain("decoder: errno on 'path' is only supported on the return value");
    });

    it("skips a hook with a Java decoder on its return value, naming the native decoders", () => {
      const getenvHook: InputNativeHookDetails = { symbol: "getenv", returns: ["char *", { decoder: "hashCode" }] };
      const nativeCollection: InputNativeHookCollection = { module: "libc.so", hooks: ["free", getenvHook] };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["free"]);
      const message = skipWarning();
      expect(message).toContain("decoder 'hashCode' is no native decoder. The native decoders are: string, base64, hex, utf16,");
    });

    it("skips a hook with a length its decoder doesn't accept", () => {
      const closeHook: InputNativeHookDetails = {
        symbol: "close",
        params: [["int", "fd", { decoder: "fd", length: 1 }]],
      };
      const nativeCollection: InputNativeHookCollection = { module: "libc.so", hooks: ["free", closeHook] };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["free"]);
      const message = skipWarning();
      expect(message).toContain("decoder 'fd' doesn't accept 'length'. It accepts neither 'length' nor 'offset'.");
    });

    it("skips a hook whose returns declaration is in an unrecognized format, without aborting the rest of the collection", () => {
      const invalidRetTypeHook = { symbol: "bad", returns: 42 as unknown as string };
      const nativeCollection: InputNativeHookCollection = {
        module: "libc.so",
        hooks: [invalidRetTypeHook, "malloc"],
      };
      const config: InputFrookyConfig = { hookCollections: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["malloc"]);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("still validates the remaining native hook collections after one collection contained an unnormalizable hook", () => {
      const brokenCollection: InputNativeHookCollection = {
        module: "libc.so",
        hooks: [{ symbol: "bad", params: [123 as unknown as string] }],
      };
      const healthyCollection: InputNativeHookCollection = { module: "libssl.so", hooks: ["SSL_write"] };
      const config: InputFrookyConfig = { hookCollections: [brokenCollection, healthyCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["SSL_write"]);
    });

    it("processes every hook independently, warning once per invalid hook without aborting the collection", () => {
      const invalidHookA = { symbol: 1 as unknown as string };
      const invalidHookB = { symbol: 2 as unknown as string };
      const nativeCollection: InputNativeHookCollection = {
        module: "libc.so",
        hooks: [invalidHookA, "validSymbol", invalidHookB],
      };
      const config: InputFrookyConfig = { hookCollections: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["validSymbol"]);
      expect(warnSpy.mock.calls.length).toBe(2);
    });

    describe("high-frequency libc hook warnings", () => {
      it("warns when nativeStackTrace is enabled on a high-frequency libc function", () => {
        const config: InputFrookyConfig = {
          hookCollections: [
            {
              module: "libc.so",
              hookSettings: { nativeStackTrace: true },
              hooks: ["open"],
            },
          ],
        };

        validator.validateAndNormalizeHooks(config, defaultSettings);

        expect(warnSpy).toHaveBeenCalled();
        const messages = warnSpy.mock.calls.map((call) => String(call[0]));
        expect(messages.some((msg) => msg.includes("Capturing stack traces on high-frequency libc function 'open' in 'libc.so'"))).toBe(true);
      });

      it("warns when javaStackTrace is enabled on a high-frequency libc function", () => {
        const config: InputFrookyConfig = {
          hookCollections: [
            {
              module: "libc.so",
              hookSettings: { javaStackTrace: true },
              hooks: ["read"],
            },
          ],
        };

        validator.validateAndNormalizeHooks(config, defaultSettings);

        expect(warnSpy).toHaveBeenCalled();
        const messages = warnSpy.mock.calls.map((call) => String(call[0]));
        expect(messages.some((msg) => msg.includes("Capturing stack traces on high-frequency libc function 'read' in 'libc.so'"))).toBe(true);
      });

      it("notes that early hooks get no Java frames before targetReady", () => {
        const infoSpy = spyOn(logger, "info");
        try {
          const hooksWith = (hookSettings: InputNativeHookCollection["hookSettings"]) =>
            validator.validateAndNormalizeHooks({ hookCollections: [{ module: "libapp.so", hooks: ["run"], hookSettings }] }, defaultSettings);
          hooksWith({ early: true, javaStackTrace: true });
          hooksWith({ early: true, nativeStackTrace: true });
          hooksWith({ javaStackTrace: true });
          const notes = infoSpy.mock.calls.map((call) => String(call[0])).filter((message) => message.includes("before-ready"));
          expect(notes).toEqual([
            "libapp.so!run has early: true and javaStackTrace: its calls before targetReady get native frames, but no Java frames (skipped: before-ready), as walking the Java stack of a thread that is still attaching to the Java VM crashes the app.",
          ]);
        } finally {
          infoSpy.mockRestore();
        }
      });

      describe("blocked functions", () => {
        const warnings = () => warnSpy.mock.calls.map((call) => String(call[0]));
        const hooksOf = (module: string, hooks: InputNativeHookCollection["hooks"], hookSettings?: InputNativeHookCollection["hookSettings"]) =>
          validator.validateAndNormalizeHooks({ hookCollections: [{ module, hooks, hookSettings }] }, defaultSettings);

        it("skips a function the hook breaks the app on", () => {
          expect(hooksOf("libc.so", ["pthread_getspecific", "getpid"]).map((hook) => hook.symbol)).toEqual(["getpid"]);
          expect(warnings()).toEqual([
            "Skipping hook for native function 'pthread_getspecific' from module 'libc.so': Frida's Interceptor uses it itself, so installing the hook hangs the app.",
          ]);
        });

        it("matches the module by its file name", () => {
          expect(hooksOf("/apex/com.android.runtime/lib64/bionic/libdl.so", ["dlopen"])).toEqual([]);
          expect(hooksOf("libc.so", ["dlopen"]).map((hook) => hook.symbol)).toEqual(["dlopen"]);
        });

        it("skips a function only under the runtime it breaks", () => {
          expect(hooksOf("libc.so", ["memset", "clock_gettime"]).map((hook) => hook.symbol)).toEqual(["memset", "clock_gettime"]);

          const script = globalThis as unknown as { Script: { runtime: string } };
          const originalScript = script.Script;
          script.Script = { runtime: "V8" };
          try {
            expect(hooksOf("libc.so", ["memset", "clock_gettime"])).toEqual([]);
          } finally {
            script.Script = originalScript;
          }
          expect(warnings()[0]).toBe(
            "Skipping hook for native function 'memset' from module 'libc.so': V8 calls it itself while it runs a hook, which re-enters V8 and crashes the app. Use the default QuickJS runtime to hook it.",
          );
        });

        it("keeps a hook without the stack traces that crash in it", () => {
          const [hook] = hooksOf("libc.so", ["sigprocmask"], { nativeStackTrace: true, javaStackTrace: true });

          expect(hook.hookSettings!.nativeStackTrace).toBe(false);
          expect(hook.hookSettings!.javaStackTrace).toBe(false);
          expect(warnings()).toEqual([
            "No stack traces for native function 'sigprocmask' from module 'libc.so': the native stack walk crashes the app in it.",
          ]);
        });

        it("keeps a hook without stack traces only under the runtime and with the early setting they break in", () => {
          const stackTraces = { nativeStackTrace: true, javaStackTrace: true };
          const script = globalThis as unknown as { Script: { runtime: string } };
          const originalScript = script.Script;
          script.Script = { runtime: "V8" };
          try {
            const [early] = hooksOf("libc.so", ["mmap"], { ...stackTraces, early: true, callerFilter: ["^libapp\\.so$"] });
            const [late] = hooksOf("libc.so", ["mmap"], stackTraces);
            expect(early.hookSettings!.nativeStackTrace).toBe(false);
            expect(early.hookSettings!.javaStackTrace).toBe(false);
            expect(late.hookSettings!.nativeStackTrace).toBe(true);
          } finally {
            script.Script = originalScript;
          }
          expect(
            hooksOf("libc.so", ["mmap"], { ...stackTraces, early: true, callerFilter: ["^libapp\\.so$"] })[0].hookSettings!.nativeStackTrace,
          ).toBe(true);
          expect(warnings()).toContain(
            "No stack traces for native function 'mmap' from module 'libc.so': with early: true, a stack trace in it under V8 stops the app's start-up.",
          );
        });

        it("keeps a hook with a callerFilter, which needs no stack walk", () => {
          expect(hooksOf("libc.so", ["sigprocmask"], { callerFilter: ["^libapp\\.so$"] }).length).toBe(1);
          expect(warnings()).toEqual([]);
        });
      });

      it("does not warn on non-libc module even if symbol matches high-frequency name", () => {
        const config: InputFrookyConfig = {
          hookCollections: [
            {
              module: "libcustom.so",
              hooks: ["open"],
            },
          ],
        };

        validator.validateAndNormalizeHooks(config, defaultSettings);

        expect(warnSpy).not.toHaveBeenCalled();
      });

      it("does not warn on low-frequency libc functions", () => {
        const config: InputFrookyConfig = {
          hookCollections: [
            {
              module: "libc.so",
              hooks: ["getenv", "unlink"],
            },
          ],
        };

        validator.validateAndNormalizeHooks(config, defaultSettings);

        expect(warnSpy).not.toHaveBeenCalled();
      });

      it("warns when early is true on a high-frequency libc function without a callerFilter", () => {
        const config: InputFrookyConfig = {
          hookCollections: [
            {
              module: "libc.so",
              hookSettings: { early: true },
              hooks: ["open"],
            },
          ],
        };

        validator.validateAndNormalizeHooks(config, defaultSettings);

        expect(warnSpy).toHaveBeenCalled();
        const messages = warnSpy.mock.calls.map((call) => String(call[0]));
        expect(
          messages.some((msg) =>
            msg.includes(
              "Early hooking enabled for high-frequency libc function 'open' in 'libc.so' without a callerFilter. This can cause deadlocks or ANRs (Application Not Responding)",
            ),
          ),
        ).toBe(true);
      });

      it("does not warn when early is true on a high-frequency libc function with a callerFilter", () => {
        const config: InputFrookyConfig = {
          hookCollections: [
            {
              module: "libc.so",
              hookSettings: { early: true, callerFilter: ["libapp.so"] },
              hooks: ["open"],
            },
          ],
        };

        validator.validateAndNormalizeHooks(config, defaultSettings);

        expect(warnSpy).not.toHaveBeenCalled();
      });

      it("does not warn when early is false on a high-frequency libc function without callerFilter and no stack traces", () => {
        const config: InputFrookyConfig = {
          hookCollections: [
            {
              module: "libc.so",
              hookSettings: { early: false },
              hooks: ["open"],
            },
          ],
        };

        validator.validateAndNormalizeHooks(config, defaultSettings);

        expect(warnSpy).not.toHaveBeenCalled();
      });
    });
  });
});

export {};
