import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS, DEFAULT_BASE_DECODER_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings } from "../frookySettings";
import { InputParam, normalizeInputParams, normalizeInputReturn } from "./inputDecodableTypes";
import {
  InputNativeHookCollection,
  InputNativeHookDetails,
  isNativeHookCollection,
  normalizeModuleOffset,
  normalizeNativeHookCollection,
} from "./inputNativeHookCollection";

import { logger } from "../logger";
import { inputNativeHookCollectionSchema, inputNativeHookSchema } from "./zodSchemas/inputNativeHookCollection.zod";

describe("inputNativeHookCollection", () => {
  describe("isNativeHookCollection()", () => {
    it("returns true for a valid InputNativeHookCollection", () => {
      const nativeHookCollection: InputNativeHookCollection = { module: "libc.so", hooks: [] };
      expect(isNativeHookCollection(nativeHookCollection)).toBeTruthy();
    });

    it("returns true when module is the only property present", () => {
      expect(isNativeHookCollection({ module: "libc.so" })).toBeTruthy();
    });

    it("returns false for a java hook collection (no module property)", () => {
      expect(isNativeHookCollection({ javaClass: "com.example.Foo", hooks: [] })).toBeFalsy();
    });

    it("returns false for an objc hook collection (no module property)", () => {
      expect(isNativeHookCollection({ type: "objc", objcClass: "NSString", hooks: [] })).toBeFalsy();
    });

    it("returns false when module and javaClass are both present", () => {
      expect(isNativeHookCollection({ module: "libc.so", javaClass: "com.example.Foo" })).toBeFalsy();
    });

    it("returns false when module and objcClass are both present", () => {
      expect(isNativeHookCollection({ module: "libc.so", objcClass: "NSString" })).toBeFalsy();
    });

    it("returns false for an empty object", () => {
      expect(isNativeHookCollection({})).toBeFalsy();
    });
  });

  describe("normalizeNativeHookCollection()", () => {
    const defaultSettings: FrookySettings = {
      hookSettings: { ...DEFAULT_HOOK_SETTINGS },
      decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS },
    };

    describe("settings merging", () => {
      it("falls back to the default hook and decoder settings when nothing overrides them", () => {
        const hookCollection: InputNativeHookCollection = { module: "libc.so", hooks: [] };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hookSettings).toEqual(DEFAULT_HOOK_SETTINGS);
        expect(result.decoderSettings).toEqual(DEFAULT_DECODER_SETTINGS);
      });

      it("lets the frookySettings passed in override the hard-coded defaults", () => {
        const hookCollection: InputNativeHookCollection = { module: "libc.so", hooks: [] };
        const settings: FrookySettings = {
          hookSettings: { ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 5 },
          decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS, maxDepth: 42 },
        };

        const result = normalizeNativeHookCollection(hookCollection, settings);

        expect(result.hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 5 });
        expect(result.decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 42 });
      });

      it("gives the hook collection's own hookSettings/decoderSettings the highest precedence", () => {
        const hookCollection: InputNativeHookCollection = {
          module: "libc.so",
          hooks: [],
          hookSettings: { maxStackFrames: 99 },
          decoderSettings: { maxDepth: 7 },
        };
        const settings: FrookySettings = {
          hookSettings: { ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 5 },
          decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS, maxDepth: 42 },
        };

        const result = normalizeNativeHookCollection(hookCollection, settings);

        expect(result.hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 99 });
        expect(result.decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 7 });
      });
    });

    describe("hook-level settings override", () => {
      it("lets a hook's own hookSettings/decoderSettings override the hook collection's settings", () => {
        const hookCollection: InputNativeHookCollection = {
          module: "libc.so",
          hookSettings: { maxStackFrames: 30 },
          decoderSettings: { maxDepth: 30 },
          hooks: [
            {
              symbol: "malloc",
              hookSettings: { ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 40 },
              decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS, maxDepth: 40 },
            },
          ],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0].hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 40 });
        expect(result.hooks[0].decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 });
      });

      it("merges the hook's own settings on top of the collection's, instead of replacing them wholesale", () => {
        // hook files contain partial settings, e.g. `hookSettings: { maxStackFrames: 40 }`
        const hookCollection: InputNativeHookCollection = {
          module: "libc.so",
          hookSettings: { maxStackFrames: 30, callerFilter: ["^collection"] },
          decoderSettings: { maxDepth: 30, maxItems: 30 },
          hooks: [
            {
              symbol: "malloc",
              // intentionally only overrides one field of each settings object
              hookSettings: { maxStackFrames: 40 },
              decoderSettings: { maxDepth: 40 },
            } as InputNativeHookDetails,
          ],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0].hookSettings).toEqual({
          ...DEFAULT_HOOK_SETTINGS,
          maxStackFrames: 40,
          callerFilter: ["^collection"],
        });
        expect(result.hooks[0].decoderSettings).toEqual({
          ...DEFAULT_DECODER_SETTINGS,
          maxDepth: 40,
          maxItems: 30,
        });
      });

      it("falls back to the hook collection's settings when a hook does not declare its own", () => {
        const hookCollection: InputNativeHookCollection = {
          module: "libc.so",
          hookSettings: { maxStackFrames: 30 },
          hooks: [{ symbol: "malloc" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0].hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 30 });
      });

      it("uses the hook's own (merged) decoderSettings, not just the collection's, to normalize that hook's params and returns", () => {
        const hookCollection: InputNativeHookCollection = {
          module: "libc.so",
          decoderSettings: { maxDepth: 30 },
          hooks: [
            {
              symbol: "memcpy",
              decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS, maxDepth: 40 },
              params: ["void *"],
              returns: "void *",
            },
          ],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);
        const hook = result.hooks[0];

        expect(hook.params?.[0]).toEqual(normalizeInputParams(["void *"], { ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 })[0]);
        expect(hook.returns).toEqual(normalizeInputReturn("void *", { ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 }));
      });
    });

    describe("hook normalization", () => {
      it("normalizes a plain symbol string into a full NativeHookDeclaration", () => {
        const hookCollection: InputNativeHookCollection = { module: "libc.so", hooks: ["malloc"] };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks).toEqual([
          { symbol: "malloc", module: "libc.so", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_BASE_DECODER_SETTINGS },
        ]);
      });

      it("throws when a length is the return value of a hook without returns", () => {
        const params: InputParam[] = ["int", ["void *", "buf", { direction: "out", length: "$ret" }], "size_t"];
        const withoutRetType: InputNativeHookCollection = {
          module: "libc.so",
          hooks: [{ symbol: "read", params }],
        };
        const withRetType: InputNativeHookCollection = {
          module: "libc.so",
          hooks: [{ symbol: "read", params, returns: "ssize_t" }],
        };

        expect(() => normalizeNativeHookCollection(withoutRetType, defaultSettings)).toThrow("'$ret' needs the hook to declare 'returns'");
        expect(normalizeNativeHookCollection(withRetType, defaultSettings).hooks.length).toBe(1);
      });

      it("normalizes params using the merged decoder settings", () => {
        const hookCollection: InputNativeHookCollection = {
          module: "libc.so",
          hooks: [{ symbol: "memcpy", params: ["void *", "void *", "size_t"] }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0]).toEqual({
          symbol: "memcpy",
          module: "libc.so",
          params: normalizeInputParams(["void *", "void *", "size_t"], DEFAULT_DECODER_SETTINGS),
          hookSettings: DEFAULT_HOOK_SETTINGS,
          decoderSettings: DEFAULT_BASE_DECODER_SETTINGS,
        });
      });

      it("normalizes returns with the merged decoder settings when present", () => {
        const hookCollection: InputNativeHookCollection = {
          module: "libc.so",
          hooks: [{ symbol: "malloc", returns: "void *" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0].returns).toEqual(normalizeInputReturn("void *", DEFAULT_DECODER_SETTINGS));
      });

      it("leaves returns undefined when the hook does not declare one", () => {
        const hookCollection: InputNativeHookCollection = {
          module: "libc.so",
          hooks: [{ symbol: "malloc" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0].returns).toBeUndefined();
      });

      it("leaves params undefined when the hook does not declare any", () => {
        const hookCollection: InputNativeHookCollection = {
          module: "libc.so",
          hooks: [{ symbol: "malloc" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0].params).toBeUndefined();
      });

      it("normalizes multiple hooks, preserving order", () => {
        const hookCollection: InputNativeHookCollection = {
          module: "libc.so",
          hooks: ["malloc", { symbol: "free" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks.map((hook) => hook.symbol)).toEqual(["malloc", "free"]);
      });

      it("normalizes a [symbol, decoderSettings] tuple, merging its decoderSettings on top of the collection's", () => {
        const hookCollection: InputNativeHookCollection = {
          module: "libc.so",
          decoderSettings: { maxDepth: 30 },
          // hook files contain partial settings, e.g. `{ decoder: "string" }`
          hooks: [["malloc", { decoder: "string" }] as [string, DecoderSettings]],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks).toEqual([
          {
            symbol: "malloc",
            module: "libc.so",
            hookSettings: DEFAULT_HOOK_SETTINGS,
            decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS, maxDepth: 30, decoder: "string" },
          },
        ]);
      });

      it("normalizes a offset hook, keeping offset instead of symbol", () => {
        const hookCollection: InputNativeHookCollection = {
          module: "libfoo.so",
          hooks: [{ offset: "0x1a2b4" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks).toEqual([
          {
            offset: "0x1a2b4",
            module: "libfoo.so",
            params: undefined,
            returns: undefined,
            hookSettings: DEFAULT_HOOK_SETTINGS,
            decoderSettings: DEFAULT_BASE_DECODER_SETTINGS,
          },
        ]);
      });
    });

    describe("settings of single values", () => {
      let warnSpy: Mock;
      beforeEach(() => {
        warnSpy = spyOn(logger, "warn");
      });
      afterEach(() => {
        warnSpy.mockRestore();
      });

      it("passes the limits and decoder of the collection and hook on to the params and the returns", () => {
        const hookCollection: InputNativeHookCollection = {
          module: "libfoo.so",
          decoderSettings: { maxItems: 7 },
          hooks: [{ symbol: "foo", decoderSettings: { decoder: "fd" }, params: ["int"], returns: ["int", { maxItems: 9 }] }],
        };

        const hook = normalizeNativeHookCollection(hookCollection, defaultSettings).hooks[0];

        expect(hook.params![0].settings).toEqual({ ...DEFAULT_BASE_DECODER_SETTINGS, maxItems: 7, decoder: "fd" });
        expect(hook.returns!.settings).toEqual({ ...DEFAULT_BASE_DECODER_SETTINGS, maxItems: 9, decoder: "fd" });
        expect(warnSpy).not.toHaveBeenCalled();
      });

      it("throws for the settings of a single parameter on a collection, a hook and a [symbol, decoderSettings] tuple", () => {
        const collection = (decoderSettings: object, hooks: unknown[]) =>
          ({ module: "libfoo.so", decoderSettings, hooks }) as InputNativeHookCollection;

        expect(() => normalizeNativeHookCollection(collection({ argFilter: ["^a"] }, ["foo"]), defaultSettings)).toThrow(
          "decoderSettings contains unknown properties: argFilter",
        );
        expect(() => normalizeNativeHookCollection(collection({}, [{ symbol: "foo", decoderSettings: { length: 1 } }]), defaultSettings)).toThrow(
          "decoderSettings contains unknown properties: length",
        );
        expect(() => normalizeNativeHookCollection(collection({}, [["bar", { maxItems: 4, argFilter: ["^b"] }]]), defaultSettings)).toThrow(
          "decoderSettings contains unknown properties: argFilter",
        );
      });

      it("keeps argFilter, length and decoderOptions of a param and decoderOptions of returns", () => {
        const hookCollection: InputNativeHookCollection = {
          module: "libfoo.so",
          hooks: [
            {
              symbol: "foo",
              params: [
                ["char *", "buf", { argFilter: ["^a"], length: "len" }],
                ["int", "len", { decoder: "bitmask", decoderOptions: { constants: { A: 1 } } }],
              ],
              returns: ["int", { decoder: "constants", decoderOptions: { constants: { OK: 0 } } }],
            },
          ],
        };

        const hook = normalizeNativeHookCollection(hookCollection, defaultSettings).hooks[0];

        expect(hook.params![0].settings).toEqual({ ...DEFAULT_DECODER_SETTINGS, argFilter: ["^a"], length: "len" });
        expect(hook.params![1].settings).toEqual({ ...DEFAULT_DECODER_SETTINGS, decoder: "bitmask", decoderOptions: { constants: { A: 1 } } });
        expect(hook.returns!.settings).toEqual({ ...DEFAULT_DECODER_SETTINGS, decoder: "constants", decoderOptions: { constants: { OK: 0 } } });
        expect(warnSpy).not.toHaveBeenCalled();
      });
    });

    describe("normalizeModuleOffset()", () => {
      it("turns a YAML number (an unquoted 0x1a2b4) into a hex string", () => {
        expect(normalizeModuleOffset(0x1a2b4)).toBe("0x1a2b4");
      });

      it("lowercases a hex string and drops leading zeros", () => {
        expect(normalizeModuleOffset("0x000000000001A2B4")).toBe("0x1a2b4");
        expect(normalizeModuleOffset("0x0")).toBe("0x0");
      });

      it("keeps an odd offset", () => {
        expect(normalizeModuleOffset("0x1a2b5")).toBe("0x1a2b5");
      });

      it("rejects a string without the 0x prefix, which could be hex or decimal", () => {
        expect(() => normalizeModuleOffset("1234")).toThrow("starting with 0x");
      });

      it("rejects a string with whitespace around it or an uppercase prefix", () => {
        for (const offset of [" 0x1a2b4", "0x1a2b4 ", "0X1A2B4", "0x", "-0x10", "1a2b4h"]) {
          expect(() => normalizeModuleOffset(offset)).toThrow("starting with 0x");
        }
      });

      it("rejects negative and non-integer numbers", () => {
        expect(() => normalizeModuleOffset(-1)).toThrow("non-negative integer");
        expect(() => normalizeModuleOffset(1.5)).toThrow("non-negative integer");
      });
    });

    it("preserves the module on the returned hook collection", () => {
      const hookCollection: InputNativeHookCollection = { module: "libc.so", hooks: [] };

      const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

      expect(result.module).toBe("libc.so");
    });
  });

  describe("schema of modules, symbols and offsets", () => {
    const collection = (module: unknown) => inputNativeHookCollectionSchema.safeParse({ module, hooks: ["open"] }).success;
    const hook = (value: unknown) => inputNativeHookSchema.safeParse(value).success;

    it("accepts a module by its file name or a pattern, and rejects an empty name, a path and whitespace", () => {
      for (const module of ["libc.so", "libssl*.so", "*", "base.odex"]) expect(collection(module)).toBe(true);
      for (const module of ["", " ", "lib c.so", "/system/lib64/libc.so", "lib/libc.so", 5, null]) expect(collection(module)).toBe(false);
    });

    it("accepts a symbol without whitespace in every form of a hook", () => {
      for (const symbol of ["open", "SSL_*", "_ZN7android6Parcel13writeString16EPKDsm", "*"]) {
        expect(hook(symbol)).toBe(true);
        expect(hook([symbol, { maxItems: 5 }])).toBe(true);
        expect(hook({ symbol })).toBe(true);
      }
      for (const symbol of ["", " ", "open ", "int open(const char *)"]) {
        expect(hook(symbol)).toBe(false);
        expect(hook([symbol, { maxItems: 5 }])).toBe(false);
        expect(hook({ symbol })).toBe(false);
      }
    });

    it("accepts an offset as a whole number that isn't negative, or as `0x` and hex digits", () => {
      for (const offset of [0x1a2b4, 0, "0x1a2b4", "0x000000000001A2B4"]) expect(hook({ offset })).toBe(true);
      for (const offset of [-1, 1.5, "1a2b4", "0X1A2B4", " 0x1a2b4", "0x", "", true, null]) expect(hook({ offset })).toBe(false);
    });
  });
});
