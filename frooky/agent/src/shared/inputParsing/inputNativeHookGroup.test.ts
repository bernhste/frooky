import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { FrookySettings } from "../frookySettings";
import { normalizeInputParam, normalizeInputRetType } from "./inputDecodableTypes";
import { InputNativeHookGroup, InputNativeHookNormalized, isNativeHookGroup, normalizeNativeHookGroup } from "./inputNativeHookGroup";

describe("inputNativeHookGroup", () => {
  describe("isNativeHookGroup()", () => {
    it("returns true for a valid InputNativeHookGroup", () => {
      const nativeHookGroup: InputNativeHookGroup = { type: "native", module: "libc.so", hooks: [] };
      expect(isNativeHookGroup(nativeHookGroup)).toBeTruthy();
    });

    it("returns true when module is the only property present", () => {
      expect(isNativeHookGroup({ module: "libc.so" })).toBeTruthy();
    });

    it("returns false for a java hook group (no module property)", () => {
      expect(isNativeHookGroup({ type: "java", javaClass: "com.example.Foo", hooks: [] })).toBeFalsy();
    });

    it("returns false for an objc hook group (no module property)", () => {
      expect(isNativeHookGroup({ type: "objc", objcClass: "NSString", hooks: [] })).toBeFalsy();
    });

    it("returns false when module and javaClass are both present", () => {
      expect(isNativeHookGroup({ module: "libc.so", javaClass: "com.example.Foo" })).toBeFalsy();
    });

    it("returns false when module and objcClass are both present", () => {
      expect(isNativeHookGroup({ module: "libc.so", objcClass: "NSString" })).toBeFalsy();
    });

    it("returns false for an empty object", () => {
      expect(isNativeHookGroup({})).toBeFalsy();
    });
  });

  describe("normalizeNativeHookGroup()", () => {
    const defaultSettings: FrookySettings = {
      hookSettings: { ...DEFAULT_HOOK_SETTINGS },
      decoderSettings: { ...DEFAULT_DECODER_SETTINGS },
    };

    describe("settings merging", () => {
      it("falls back to the default hook and decoder settings when nothing overrides them", () => {
        const hookGroup: InputNativeHookGroup = { type: "native", module: "libc.so", hooks: [] };

        const result = normalizeNativeHookGroup(hookGroup, defaultSettings);

        expect(result.hookSettings).toEqual(DEFAULT_HOOK_SETTINGS);
        expect(result.decoderSettings).toEqual(DEFAULT_DECODER_SETTINGS);
      });

      it("lets the frookySettings passed in override the hard-coded defaults", () => {
        const hookGroup: InputNativeHookGroup = { type: "native", module: "libc.so", hooks: [] };
        const settings: FrookySettings = {
          hookSettings: { ...DEFAULT_HOOK_SETTINGS, stackTraceLimit: 5 },
          decoderSettings: { ...DEFAULT_DECODER_SETTINGS, magicDecode: true },
        };

        const result = normalizeNativeHookGroup(hookGroup, settings);

        expect(result.hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, stackTraceLimit: 5 });
        expect(result.decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, magicDecode: true });
      });

      it("gives the hook group's own hookSettings/decoderSettings the highest precedence", () => {
        const hookGroup: InputNativeHookGroup = {
          type: "native",
          module: "libc.so",
          hooks: [],
          hookSettings: { stackTraceLimit: 99 },
          decoderSettings: { magicDecode: false },
        };
        const settings: FrookySettings = {
          hookSettings: { ...DEFAULT_HOOK_SETTINGS, stackTraceLimit: 5 },
          decoderSettings: { ...DEFAULT_DECODER_SETTINGS, magicDecode: true },
        };

        const result = normalizeNativeHookGroup(hookGroup, settings);

        expect(result.hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, stackTraceLimit: 99 });
        expect(result.decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, magicDecode: false });
      });
    });

    describe("hook normalization", () => {
      it("normalizes a plain symbol string into a full InputNativeHookNormalized", () => {
        const hookGroup: InputNativeHookGroup = { type: "native", module: "libc.so", hooks: ["malloc"] };

        const result = normalizeNativeHookGroup(hookGroup, defaultSettings);

        expect(result.hooks).toEqual([
          { symbol: "malloc", module: "libc.so", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS },
        ]);
      });

      it("normalizes an object-form hook, always using the hook group's module", () => {
        const hookGroup: InputNativeHookGroup = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "malloc", module: "libwrong.so" }],
        };

        const result = normalizeNativeHookGroup(hookGroup, defaultSettings);

        expect(result.hooks).toEqual([
          { symbol: "malloc", module: "libc.so", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS },
        ]);
      });

      it("normalizes params using the merged decoder settings", () => {
        const hookGroup: InputNativeHookGroup = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "memcpy", module: "libc.so", params: ["void *", "void *", "size_t"] }],
        };

        const result = normalizeNativeHookGroup(hookGroup, defaultSettings);

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
        const hookGroup: InputNativeHookGroup = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "malloc", module: "libc.so", retType: "void *" }],
        };

        const result = normalizeNativeHookGroup(hookGroup, defaultSettings);

        expect((result.hooks[0] as InputNativeHookNormalized).retType).toEqual(normalizeInputRetType("void *", DEFAULT_DECODER_SETTINGS));
      });

      it("leaves retType undefined when the hook does not declare one", () => {
        const hookGroup: InputNativeHookGroup = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "malloc", module: "libc.so" }],
        };

        const result = normalizeNativeHookGroup(hookGroup, defaultSettings);

        expect((result.hooks[0] as InputNativeHookNormalized).retType).toBeUndefined();
      });

      it("leaves params undefined when the hook does not declare any", () => {
        const hookGroup: InputNativeHookGroup = {
          type: "native",
          module: "libc.so",
          hooks: [{ symbol: "malloc", module: "libc.so" }],
        };

        const result = normalizeNativeHookGroup(hookGroup, defaultSettings);

        expect((result.hooks[0] as InputNativeHookNormalized).params).toBeUndefined();
      });

      it("normalizes multiple hooks, preserving order", () => {
        const hookGroup: InputNativeHookGroup = {
          type: "native",
          module: "libc.so",
          hooks: ["malloc", { symbol: "free", module: "libc.so" }],
        };

        const result = normalizeNativeHookGroup(hookGroup, defaultSettings);

        expect(result.hooks.map((hook) => (hook as InputNativeHookNormalized).symbol)).toEqual(["malloc", "free"]);
      });
    });

    it("preserves the type and module on the returned hook group", () => {
      const hookGroup: InputNativeHookGroup = { type: "native", module: "libc.so", hooks: [] };

      const result = normalizeNativeHookGroup(hookGroup, defaultSettings);

      expect(result.type).toBe("native");
      expect(result.module).toBe("libc.so");
    });
  });
});

export {};
