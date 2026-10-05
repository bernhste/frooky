import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS, DEFAULT_BASE_DECODER_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings } from "../frookySettings";
import { InputParam, normalizeInputParams, normalizeInputRetType } from "./inputDecodableTypes";
import {
  InputNativeHookCollection,
  InputNativeHookDetails,
  isNativeHookCollection,
  normalizeModuleOffset,
  normalizeNativeHookCollection,
} from "./inputNativeHookCollection";

import { logger } from "../logger";

describe("inputNativeHookCollection", () => {
  describe("isNativeHookCollection()", () => {
    it("returns true for a valid InputNativeHookCollection", () => {
      const nativeHookCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: [] };
      expect(isNativeHookCollection(nativeHookCollection)).toBeTruthy();
    });

    it("returns true when module is the only property present", () => {
      expect(isNativeHookCollection({ module: "libc.so" })).toBeTruthy();
    });

    it("returns false for a java hook collection (no module property)", () => {
      expect(isNativeHookCollection({ type: "java", javaClass: "com.example.Foo", hooks: [] })).toBeFalsy();
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
        const hookCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: [] };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hookSettings).toEqual(DEFAULT_HOOK_SETTINGS);
        expect(result.decoderSettings).toEqual(DEFAULT_DECODER_SETTINGS);
      });

      it("lets the frookySettings passed in override the hard-coded defaults", () => {
        const hookCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: [] };
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
          type: "native",
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
          type: "native",
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
          type: "native",
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
          type: "native",
          module: "libc.so",
          hookSettings: { maxStackFrames: 30 },
          hooks: [{ symbol: "malloc" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0].hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 30 });
      });

      it("uses the hook's own (merged) decoderSettings, not just the collection's, to normalize that hook's params and retType", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          decoderSettings: { maxDepth: 30 },
          hooks: [
            {
              symbol: "memcpy",
              decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS, maxDepth: 40 },
              params: ["void *"],
              retType: "void *",
            },
          ],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);
        const hook = result.hooks[0];

        expect(hook.params?.[0]).toEqual(normalizeInputParams(["void *"], { ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 })[0]);
        expect(hook.retType).toEqual(normalizeInputRetType("void *", { ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 }));
      });
    });

    describe("hook normalization", () => {
      it("normalizes a plain symbol string into a full NativeHookDeclaration", () => {
        const hookCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: ["malloc"] };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks).toEqual([
          { symbol: "malloc", module: "libc.so", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_BASE_DECODER_SETTINGS },
        ]);
      });

      it("throws when a decoderArgs role is the return value of a hook without retType", () => {
        const params: InputParam[] = ["int", ["void *", "buf", { direction: "out", decoderArgs: { length: "$ret" } }], "size_t"];
        const withoutRetType: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "read", params }],
        };
        const withRetType: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "read", params, retType: "ssize_t" }],
        };

        expect(() => normalizeNativeHookCollection(withoutRetType, defaultSettings)).toThrow("needs the hook to declare a 'retType'");
        expect(normalizeNativeHookCollection(withRetType, defaultSettings).hooks.length).toBe(1);
      });

      it("normalizes params using the merged decoder settings", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
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

      it("normalizes retType with the merged decoder settings when present", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "malloc", retType: "void *" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0].retType).toEqual(normalizeInputRetType("void *", DEFAULT_DECODER_SETTINGS));
      });

      it("leaves retType undefined when the hook does not declare one", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "malloc" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0].retType).toBeUndefined();
      });

      it("leaves params undefined when the hook does not declare any", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "malloc" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0].params).toBeUndefined();
      });

      it("normalizes multiple hooks, preserving order", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hooks: ["malloc", { symbol: "free" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks.map((hook) => hook.symbol)).toEqual(["malloc", "free"]);
      });

      it("normalizes a [symbol, decoderSettings] tuple, merging its decoderSettings on top of the collection's", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
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
          type: "native",
          module: "libfoo.so",
          hooks: [{ offset: "0x1a2b4" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks).toEqual([
          {
            offset: "0x1a2b4",
            module: "libfoo.so",
            params: undefined,
            retType: undefined,
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

      it("passes the limits and decoder of the collection and hook on to the params and the retType", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libfoo.so",
          decoderSettings: { maxItems: 7 },
          hooks: [{ symbol: "foo", decoderSettings: { decoder: "fd" }, params: ["int"], retType: ["int", { maxItems: 9 }] }],
        };

        const hook = normalizeNativeHookCollection(hookCollection, defaultSettings).hooks[0];

        expect(hook.params![0].settings).toEqual({ ...DEFAULT_BASE_DECODER_SETTINGS, maxItems: 7, decoder: "fd" });
        expect(hook.retType!.settings).toEqual({ ...DEFAULT_BASE_DECODER_SETTINGS, maxItems: 9, decoder: "fd" });
        expect(warnSpy).not.toHaveBeenCalled();
      });

      it("ignores argFilter, decoderArgs and config of a collection, a hook and a [symbol, decoderSettings] tuple, with a warning", () => {
        const hookCollection = {
          type: "native",
          module: "libfoo.so",
          decoderSettings: { argFilter: ["^a"] },
          hooks: [
            { symbol: "foo", decoderSettings: { config: { constants: { A: 1 } }, decoderArgs: { length: 1 } }, params: ["int"], retType: "int" },
            ["bar", { maxItems: 4, argFilter: ["^b"] }],
          ],
        } as unknown as InputNativeHookCollection;

        const [foo, bar] = normalizeNativeHookCollection(hookCollection, defaultSettings).hooks;

        for (const settings of [foo.decoderSettings, foo.params![0].settings, foo.retType!.settings, bar.decoderSettings]) {
          const defined = Object.entries(settings)
            .filter(([, value]) => value !== undefined)
            .map(([key]) => key);
          expect(defined).not.toContain("argFilter");
          expect(defined).not.toContain("config");
          expect(defined).not.toContain("decoderArgs");
        }
        expect(bar.decoderSettings.maxItems).toBe(4);
        expect(warnSpy).toHaveBeenCalledTimes(3);
      });

      it("keeps argFilter, decoderArgs and config of a param and config of a retType", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libfoo.so",
          hooks: [
            {
              symbol: "foo",
              params: [
                ["char *", "buf", { argFilter: ["^a"], decoderArgs: { length: "len" } }],
                ["int", "len", { decoder: "bitmask", config: { constants: { A: 1 } } }],
              ],
              retType: ["int", { decoder: "constants", config: { constants: { OK: 0 } } }],
            },
          ],
        };

        const hook = normalizeNativeHookCollection(hookCollection, defaultSettings).hooks[0];

        expect(hook.params![0].settings).toEqual({ ...DEFAULT_DECODER_SETTINGS, argFilter: ["^a"], decoderArgs: { length: "len" } });
        expect(hook.params![1].settings).toEqual({ ...DEFAULT_DECODER_SETTINGS, decoder: "bitmask", config: { constants: { A: 1 } } });
        expect(hook.retType!.settings).toEqual({ ...DEFAULT_DECODER_SETTINGS, decoder: "constants", config: { constants: { OK: 0 } } });
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

      it("rejects negative and non-integer numbers", () => {
        expect(() => normalizeModuleOffset(-1)).toThrow("non-negative integer");
        expect(() => normalizeModuleOffset(1.5)).toThrow("non-negative integer");
      });
    });

    it("preserves the type and module on the returned hook collection", () => {
      const hookCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: [] };

      const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

      expect(result.type).toBe("native");
      expect(result.module).toBe("libc.so");
    });
  });
});

export {};
