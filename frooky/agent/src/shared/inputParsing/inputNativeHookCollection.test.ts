import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings } from "../frookySettings";
import { normalizeInputParam, normalizeInputRetType } from "./inputDecodableTypes";
import {
  InputNativeHookCollection,
  InputNativeHookNormalized,
  isNativeHookCollection,
  normalizeNativeHookCollection,
} from "./inputNativeHookCollection";

describe("inputNativeHookCollection", () => {
  describe("isNativeHookCollection()", () => {
    it("returns true for a valid InputNativeHookCollection", () => {
      const nativeHookCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: [] };
      expect(isNativeHookCollection(nativeHookCollection)).toBeTruthy();
    });

    it("returns true when module is the only property present", () => {
      expect(isNativeHookCollection({ module: "libc.so" })).toBeTruthy();
    });

    it("returns false for a java hook group (no module property)", () => {
      expect(isNativeHookCollection({ type: "java", javaClass: "com.example.Foo", hooks: [] })).toBeFalsy();
    });

    it("returns false for an objc hook group (no module property)", () => {
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
      decoderSettings: { ...DEFAULT_DECODER_SETTINGS },
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
          hookSettings: { ...DEFAULT_HOOK_SETTINGS, stackTraceLimit: 5 },
          decoderSettings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 42 },
        };

        const result = normalizeNativeHookCollection(hookCollection, settings);

        expect(result.hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, stackTraceLimit: 5 });
        expect(result.decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 42 });
      });

      it("gives the hook group's own hookSettings/decoderSettings the highest precedence", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hooks: [],
          hookSettings: { stackTraceLimit: 99 },
          decoderSettings: { maxDepth: 7 },
        };
        const settings: FrookySettings = {
          hookSettings: { ...DEFAULT_HOOK_SETTINGS, stackTraceLimit: 5 },
          decoderSettings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 42 },
        };

        const result = normalizeNativeHookCollection(hookCollection, settings);

        expect(result.hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, stackTraceLimit: 99 });
        expect(result.decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 7 });
      });
    });

    describe("hook-level settings override", () => {
      it("lets a hook's own hookSettings/decoderSettings override the hook group's settings", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hookSettings: { stackTraceLimit: 30 },
          decoderSettings: { maxDepth: 30 },
          hooks: [
            {
              symbol: "malloc",
              module: "libc.so",
              hookSettings: { ...DEFAULT_HOOK_SETTINGS, stackTraceLimit: 40 },
              decoderSettings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 },
            },
          ],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect((result.hooks[0] as InputNativeHookNormalized).hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, stackTraceLimit: 40 });
        expect((result.hooks[0] as InputNativeHookNormalized).decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 });
      });

      it("merges the hook's own settings on top of the group's, instead of replacing them wholesale", () => {
        // A YAML author only ever writes a *partial* hookSettings/decoderSettings on a hook (e.g.
        // `hookSettings: { stackTraceLimit: 40 }`); the raw config is cast to the input types at
        // the YAML boundary (see index.frida.ts) without being structurally checked against them,
        // so this models that real shape rather than the always-complete post-normalize shape.
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hookSettings: { stackTraceLimit: 30, stackTraceFilter: ["^group"] },
          decoderSettings: { maxDepth: 30, maxItems: 30 },
          hooks: [
            {
              symbol: "malloc",
              module: "libc.so",
              // intentionally only overrides one field of each settings object
              hookSettings: { stackTraceLimit: 40 },
              decoderSettings: { maxDepth: 40 },
            } as InputNativeHookNormalized,
          ],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect((result.hooks[0] as InputNativeHookNormalized).hookSettings).toEqual({ stackTraceLimit: 40, stackTraceFilter: ["^group"] });
        expect((result.hooks[0] as InputNativeHookNormalized).decoderSettings).toEqual({
          ...DEFAULT_DECODER_SETTINGS,
          maxDepth: 40,
          maxItems: 30,
        });
      });

      it("falls back to the hook group's settings when a hook does not declare its own", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hookSettings: { stackTraceLimit: 30 },
          hooks: [{ symbol: "malloc", module: "libc.so" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect((result.hooks[0] as InputNativeHookNormalized).hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, stackTraceLimit: 30 });
      });

      it("uses the hook's own (merged) decoderSettings, not just the group's, to normalize that hook's params and retType", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          decoderSettings: { maxDepth: 30 },
          hooks: [
            {
              symbol: "memcpy",
              module: "libc.so",
              decoderSettings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 },
              params: ["void *"],
              retType: "void *",
            },
          ],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);
        const hook = result.hooks[0] as InputNativeHookNormalized;

        expect(hook.params?.[0]).toEqual(normalizeInputParam("void *", { ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 }));
        expect(hook.retType).toEqual(normalizeInputRetType("void *", { ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 }));
      });
    });

    describe("hook normalization", () => {
      it("normalizes a plain symbol string into a full InputNativeHookNormalized", () => {
        const hookCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: ["malloc"] };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks).toEqual([
          { symbol: "malloc", module: "libc.so", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS },
        ]);
      });

      it("normalizes an object-form hook, always using the hook group's module", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "malloc", module: "libwrong.so" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks).toEqual([
          { symbol: "malloc", module: "libc.so", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS },
        ]);
      });

      it("normalizes params using the merged decoder settings", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "memcpy", module: "libc.so", params: ["void *", "void *", "size_t"] }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0]).toEqual({
          symbol: "memcpy",
          module: "libc.so",
          params: [
            normalizeInputParam("void *", DEFAULT_DECODER_SETTINGS),
            normalizeInputParam("void *", DEFAULT_DECODER_SETTINGS),
            normalizeInputParam("size_t", DEFAULT_DECODER_SETTINGS),
          ],
          hookSettings: DEFAULT_HOOK_SETTINGS,
          decoderSettings: DEFAULT_DECODER_SETTINGS,
        });
      });

      it("normalizes retType with the merged decoder settings when present", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "malloc", module: "libc.so", retType: "void *" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect((result.hooks[0] as InputNativeHookNormalized).retType).toEqual(normalizeInputRetType("void *", DEFAULT_DECODER_SETTINGS));
      });

      it("leaves retType undefined when the hook does not declare one", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "malloc", module: "libc.so" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect((result.hooks[0] as InputNativeHookNormalized).retType).toBeUndefined();
      });

      it("leaves params undefined when the hook does not declare any", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "malloc", module: "libc.so" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect((result.hooks[0] as InputNativeHookNormalized).params).toBeUndefined();
      });

      it("normalizes multiple hooks, preserving order", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          hooks: ["malloc", { symbol: "free", module: "libc.so" }],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks.map((hook) => (hook as InputNativeHookNormalized).symbol)).toEqual(["malloc", "free"]);
      });

      it("normalizes a [symbol, decoderSettings] tuple, merging its decoderSettings on top of the group's", () => {
        const hookCollection: InputNativeHookCollection = {
          type: "native",
          module: "libc.so",
          decoderSettings: { maxDepth: 30 },
          // A YAML author only ever writes a *partial* decoderSettings on a tuple hook (e.g. `{decoder: "string"}`);
          // the raw config is cast to the input types at the YAML boundary without being structurally checked
          // against them, so this models that real shape rather than the always-complete post-normalize shape.
          hooks: [["malloc", { decoder: "string" }] as [string, DecoderSettings]],
        };

        const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

        expect(result.hooks).toEqual([
          {
            symbol: "malloc",
            module: "libc.so",
            hookSettings: DEFAULT_HOOK_SETTINGS,
            decoderSettings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 30, decoder: "string" },
          },
        ]);
      });
    });

    it("preserves the type and module on the returned hook group", () => {
      const hookCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: [] };

      const result = normalizeNativeHookCollection(hookCollection, defaultSettings);

      expect(result.type).toBe("native");
      expect(result.module).toBe("libc.so");
    });
  });
});

export {};
