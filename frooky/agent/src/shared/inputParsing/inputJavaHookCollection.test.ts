import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS, DEFAULT_BASE_DECODER_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings } from "../frookySettings";
import { normalizeInputParams } from "./inputDecodableTypes";
import { InputJavaHookCollection, InputJavaHookDetails, isJavaHookScope, normalizeJavaHookCollection } from "./inputJavaHookCollection";
import { logger } from "../logger";
import { inputJavaHookSchema } from "./zodSchemas/inputJavaHookCollection.zod";

describe("inputJavaHookCollection", () => {
  describe("isJavaHookScope()", () => {
    it("returns true for a valid InputJavaHookCollection", () => {
      const javaHookCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.Foo", hooks: [] };
      expect(isJavaHookScope(javaHookCollection)).toBeTruthy();
    });

    it("returns false for an objc hook collection (no javaClass property)", () => {
      expect(isJavaHookScope({ type: "objc", objcClass: "NSString", hooks: [] })).toBeFalsy();
    });

    it("returns false for a native hook collection (no javaClass property)", () => {
      expect(isJavaHookScope({ type: "native", module: "libc.so", hooks: [] })).toBeFalsy();
    });

    it("returns true when javaClass is the only property present", () => {
      expect(isJavaHookScope({ javaClass: "com.example.Foo" })).toBeTruthy();
    });

    it("returns true even when javaClass is an empty string, since only key presence is checked", () => {
      expect(isJavaHookScope({ javaClass: "" })).toBeTruthy();
    });

    it("returns false for an empty object", () => {
      expect(isJavaHookScope({})).toBeFalsy();
    });
  });

  describe("normalizeJavaHookCollection()", () => {
    const defaultSettings: FrookySettings = {
      hookSettings: { ...DEFAULT_HOOK_SETTINGS },
      decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS },
    };

    describe("settings merging", () => {
      it("falls back to the default hook and decoder settings when nothing overrides them", () => {
        const hookCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.Foo", hooks: [] };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect(result.hookSettings).toEqual(DEFAULT_HOOK_SETTINGS);
        expect(result.decoderSettings).toEqual(DEFAULT_DECODER_SETTINGS);
      });

      it("lets the frookySettings passed in override the hard-coded defaults", () => {
        const hookCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.Foo", hooks: [] };
        const settings: FrookySettings = {
          hookSettings: { ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 5 },
          decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS, maxDepth: 42 },
        };

        const result = normalizeJavaHookCollection(hookCollection, settings);

        expect(result.hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 5 });
        expect(result.decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 42 });
      });

      it("gives the hook collection's own hookSettings/decoderSettings the highest precedence", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hooks: [],
          hookSettings: { maxStackFrames: 99 },
          decoderSettings: { maxDepth: 7 },
        };
        const settings: FrookySettings = {
          hookSettings: { ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 5 },
          decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS, maxDepth: 42 },
        };

        const result = normalizeJavaHookCollection(hookCollection, settings);

        expect(result.hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 99 });
        expect(result.decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 7 });
      });
    });

    describe("hook-level settings override", () => {
      it("lets a hook's own hookSettings/decoderSettings override the hook collection's settings", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hookSettings: { maxStackFrames: 30 },
          decoderSettings: { maxDepth: 30 },
          hooks: [
            {
              method: "bar",
              hookSettings: { ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 40 },
              decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS, maxDepth: 40 },
            },
          ],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0].hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 40 });
        expect(result.hooks[0].decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 });
      });

      it("merges the hook's own settings on top of the collection's, instead of replacing them wholesale", () => {
        // hook files contain partial settings, e.g. `hookSettings: { maxStackFrames: 40 }`
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hookSettings: { maxStackFrames: 30, callerFilter: ["^collection"] },
          decoderSettings: { maxDepth: 30, maxItems: 30 },
          hooks: [
            {
              method: "bar",
              // intentionally only overrides one field of each settings object
              hookSettings: { maxStackFrames: 40 },
              decoderSettings: { maxDepth: 40 },
            } as InputJavaHookDetails,
          ],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

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
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hookSettings: { maxStackFrames: 30 },
          hooks: [{ method: "bar" }],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0].hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 30 });
      });

      it("uses the hook's own (merged) decoderSettings, not just the collection's, to normalize that hook's overloads", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          decoderSettings: { maxDepth: 30 },
          hooks: [
            {
              method: "bar",
              decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS, maxDepth: 40 },
              overloads: [{ params: ["int"] }],
            },
          ],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);
        const hook = result.hooks[0];

        expect(hook.overloads?.[0].params[0]).toEqual(normalizeInputParams(["int"], { ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 })[0]);
      });
    });

    describe("hook normalization", () => {
      it("normalizes a plain method name string into a full JavaHookDeclaration", () => {
        const hookCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.Foo", hooks: ["bar"] };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect(result.hooks).toEqual([
          { javaClass: "com.example.Foo", method: "bar", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_BASE_DECODER_SETTINGS },
        ]);
      });

      it("normalizes each overload's params using the merged decoder settings", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hooks: [
            {
              method: "bar",
              overloads: [{ params: ["int", "java.lang.String"] }],
            },
          ],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0]).toEqual({
          javaClass: "com.example.Foo",
          method: "bar",
          overloads: [
            {
              params: normalizeInputParams(["int", "java.lang.String"], DEFAULT_DECODER_SETTINGS),
            },
          ],
          hookSettings: DEFAULT_HOOK_SETTINGS,
          decoderSettings: DEFAULT_BASE_DECODER_SETTINGS,
        });
      });

      it("normalizes an overload's retType decoder settings, merged on top of the hook's decoder settings", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          decoderSettings: { maxDepth: 30 },
          hooks: [
            {
              method: "bar",
              overloads: [{ params: ["int"], retType: { decoder: "hashCode" } }],
            },
          ],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);
        const hook = result.hooks[0];

        expect(hook.overloads?.[0].retType).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 30, decoder: "hashCode" });
      });

      it("leaves an overload's retType undefined when not declared", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hooks: [{ method: "bar", overloads: [{ params: ["int"] }] }],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);
        const hook = result.hooks[0];

        expect(hook.overloads?.[0].retType).toBeUndefined();
      });

      it("is rejected by the schema for a type declaration in an overload's retType", () => {
        for (const retType of ["int", ["int", { decoder: "hashCode" }]]) {
          expect(inputJavaHookSchema.safeParse({ method: "bar", overloads: [{ params: ["int"], retType }] }).success).toBe(false);
        }
      });

      it("normalizes multiple hooks, preserving order", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hooks: ["bar", { method: "baz" }],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect(result.hooks.map((hook) => hook.method)).toEqual(["bar", "baz"]);
      });

      it("normalizes a [method, decoderSettings] tuple, merging its decoderSettings on top of the collection's", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          decoderSettings: { maxDepth: 30 },
          // hook files contain partial settings, e.g. `{ decoder: "string" }`
          hooks: [["bar", { decoder: "string" }] as [string, DecoderSettings]],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect(result.hooks).toEqual([
          {
            javaClass: "com.example.Foo",
            method: "bar",
            hookSettings: DEFAULT_HOOK_SETTINGS,
            decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS, maxDepth: 30, decoder: "string" },
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

      it("passes the limits and decoder of the file, collection and hook on to the params and the retType", () => {
        const settings: FrookySettings = {
          hookSettings: DEFAULT_HOOK_SETTINGS,
          decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS, maxDepth: 3 },
        };
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          decoderSettings: { maxItems: 7 },
          hooks: [
            { method: "bar", decoderSettings: { decoder: "hashCode" }, overloads: [{ params: ["java.lang.Object"], retType: { maxItems: 9 } }] },
          ],
        };

        const overload = normalizeJavaHookCollection(hookCollection, settings).hooks[0].overloads![0];

        expect(overload.params[0].settings).toEqual({ maxDepth: 3, maxItems: 7, decoder: "hashCode" });
        expect(overload.retType).toEqual({ maxDepth: 3, maxItems: 9, decoder: "hashCode" });
        expect(warnSpy).not.toHaveBeenCalled();
      });

      it("lets a param override the decoder of its hook", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hooks: [
            { method: "bar", decoderSettings: { decoder: "hashCode" }, overloads: [{ params: [["java.lang.String", { decoder: "base64" }]] }] },
          ],
        };

        const param = normalizeJavaHookCollection(hookCollection, defaultSettings).hooks[0].overloads![0].params[0];

        expect(param.settings.decoder).toBe("base64");
      });

      it("ignores argFilter, decoderArgs and config of a collection and a hook, with a warning", () => {
        const hookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          decoderSettings: { maxItems: 7, argFilter: ["^a"] },
          hooks: [
            {
              method: "bar",
              decoderSettings: { config: { constants: { A: 1 } }, decoderArgs: { length: 1 } },
              overloads: [{ params: ["int"], retType: {} }],
            },
          ],
        } as unknown as InputJavaHookCollection;

        const hook = normalizeJavaHookCollection(hookCollection, defaultSettings).hooks[0];
        const param = hook.overloads![0].params[0];

        for (const settings of [hook.decoderSettings, param.settings, hook.overloads![0].retType!]) {
          const defined = Object.entries(settings)
            .filter(([, value]) => value !== undefined)
            .map(([key]) => key);
          expect(defined).not.toContain("argFilter");
          expect(defined).not.toContain("config");
          expect(defined).not.toContain("decoderArgs");
        }
        expect(param.settings.maxItems).toBe(7);
        expect(warnSpy).toHaveBeenCalledWith("Decoder settings contain unknown properties: argFilter");
        expect(warnSpy).toHaveBeenCalledWith("Decoder settings contain unknown properties: config, decoderArgs");
      });

      it("ignores argFilter in the decoderSettings of a [method, decoderSettings] tuple", () => {
        const hookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hooks: [["bar", { maxItems: 4, argFilter: ["^a"] }]],
        } as unknown as InputJavaHookCollection;

        const hook = normalizeJavaHookCollection(hookCollection, defaultSettings).hooks[0];

        expect(hook.decoderSettings).toEqual({ ...DEFAULT_BASE_DECODER_SETTINGS, maxItems: 4 });
        expect(Object.keys(hook.decoderSettings)).not.toContain("argFilter");
        expect(warnSpy).toHaveBeenCalledWith("Decoder settings contain unknown properties: argFilter");
      });

      it("keeps argFilter, decoderArgs and config of a param and config of a retType", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hooks: [
            {
              method: "bar",
              overloads: [
                {
                  params: [
                    ["[B", "data", { argFilter: ["^a"], decoderArgs: { length: "len" } }],
                    ["int", "len", { decoder: "bitmask", config: { constants: { A: 1 } } }],
                  ],
                  retType: { decoder: "bitmask", config: { constants: { B: 2 } } },
                },
              ],
            },
          ],
        };

        const overload = normalizeJavaHookCollection(hookCollection, defaultSettings).hooks[0].overloads![0];

        expect(overload.params[0].settings).toEqual({ ...DEFAULT_DECODER_SETTINGS, argFilter: ["^a"], decoderArgs: { length: "len" } });
        expect(overload.params[1].settings).toEqual({ ...DEFAULT_DECODER_SETTINGS, decoder: "bitmask", config: { constants: { A: 1 } } });
        expect(overload.retType).toEqual({ ...DEFAULT_DECODER_SETTINGS, decoder: "bitmask", config: { constants: { B: 2 } } });
        expect(warnSpy).not.toHaveBeenCalled();
      });
    });

    it("preserves the type and javaClass on the returned hook collection", () => {
      const hookCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.Foo", hooks: [] };

      const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

      expect(result.type).toBe("java");
      expect(result.javaClass).toBe("com.example.Foo");
    });
  });
});

export {};
