import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { InputJavaHookCollection } from "../../shared/inputParsing/inputJavaHookCollection";
import { InputNativeHookCollection } from "../../shared/inputParsing/inputNativeHookCollection";
import { logger } from "../../shared/logger";
import { NativeHookValidator } from "./nativeHookValidator";

const defaultSettings: FrookySettings = {
  hookSettings: { ...DEFAULT_HOOK_SETTINGS },
  decoderSettings: { ...DEFAULT_DECODER_SETTINGS },
};

describe("NativeHookValidator", () => {
  const validator = new NativeHookValidator();

  describe("getPlatformHookCollections()", () => {
    it("returns an empty array for an empty hookCollection list", () => {
      const config: InputFrookyConfig = { hookCollection: [] };
      expect(validator.getPlatformHookCollections(config)).toEqual([]);
    });

    it("returns only the native hook groups from a mixed hookCollection list, preserving order", () => {
      const nativeGroupA: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: [] };
      const javaGroup: InputJavaHookCollection = { type: "java", javaClass: "com.example.A", hooks: [] };
      const nativeGroupB: InputNativeHookCollection = { type: "native", module: "libssl.so", hooks: [] };
      const config: InputFrookyConfig = { hookCollection: [nativeGroupA, javaGroup, nativeGroupB] as unknown as InputNativeHookCollection[] };

      expect(validator.getPlatformHookCollections(config)).toEqual([nativeGroupA, nativeGroupB]);
    });

    it("returns an empty array when there are no native hook groups", () => {
      const javaGroup: InputJavaHookCollection = { type: "java", javaClass: "com.example.A", hooks: [] };
      const config: InputFrookyConfig = { hookCollection: [javaGroup] as unknown as InputNativeHookCollection[] };

      expect(validator.getPlatformHookCollections(config)).toEqual([]);
    });
  });

  describe("validateAndNormalizeHooks()", () => {
    let warnSpy: Mock;

    beforeEach(() => {
      warnSpy = spyOn(logger, "warn");
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("returns an empty array when the config has no native hook groups", () => {
      const config: InputFrookyConfig = { hookCollection: [] };
      expect(validator.validateAndNormalizeHooks(config, defaultSettings)).toEqual([]);
    });

    it("normalizes a plain symbol-name hook into a full InputNativeHookNormalized", () => {
      const nativeGroup: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: ["malloc"] };
      const config: InputFrookyConfig = { hookCollection: [nativeGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result).toEqual([
        { symbol: "malloc", module: "libc.so", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS },
      ]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("collects hooks from multiple native hook groups, ignoring non-native hook groups", () => {
      const nativeGroupA: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: ["malloc"] };
      const javaGroup: InputJavaHookCollection = { type: "java", javaClass: "com.example.A", hooks: ["foo"] };
      const nativeGroupB: InputNativeHookCollection = { type: "native", module: "libssl.so", hooks: ["SSL_write"] };
      const config: InputFrookyConfig = { hookCollection: [nativeGroupA, javaGroup, nativeGroupB] as unknown as InputNativeHookCollection[] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["malloc", "SSL_write"]);
    });

    it("always uses the hook group's module, ignoring a module set on the hook itself", () => {
      const nativeGroup: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: [{ symbol: "malloc", module: "libwrong.so" }],
      };
      const config: InputFrookyConfig = { hookCollection: [nativeGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result[0].module).toBe("libc.so");
    });

    it("normalizes params and retType using the merged decoder settings", () => {
      const nativeGroup: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: [{ symbol: "memcpy", module: "libc.so", params: ["void *", "void *", "size_t"], retType: "void *" }],
      };
      const config: InputFrookyConfig = { hookCollection: [nativeGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result[0].params).toEqual([
        { type: "void *", direction: "in", settings: DEFAULT_DECODER_SETTINGS },
        { type: "void *", direction: "in", settings: DEFAULT_DECODER_SETTINGS },
        { type: "size_t", direction: "in", settings: DEFAULT_DECODER_SETTINGS },
      ]);
      expect(result[0].retType).toEqual({ type: "void *", settings: DEFAULT_DECODER_SETTINGS });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("skips a hook that fails schema validation, warns about it, and still keeps the valid hooks", () => {
      const invalidHook = { symbol: 123 as unknown as string, module: "libc.so" };
      const nativeGroup: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: ["validSymbol", invalidHook],
      };
      const config: InputFrookyConfig = { hookCollection: [nativeGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["validSymbol"]);
      expect(warnSpy).toHaveBeenCalled();
      const [messageLines] = warnSpy.mock.calls[0] as [string[]];
      expect(messageLines[0]).toContain("Skipping hook for function with the symbol name '123' from module 'libc.so' due to an invalid declaration.");
    });

    it("skips a hook whose param declaration is in an unrecognized format, without aborting the rest of the group", () => {
      // A bare number is not a valid InputParam shape (not a string, tuple, or Param object) and
      // makes normalization throw a plain Error rather than a ZodError - this must still be caught per-hook.
      const invalidParamHook = { symbol: "bad", module: "libc.so", params: [123 as unknown as string] };
      const nativeGroup: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: ["free", invalidParamHook, "malloc"],
      };
      const config: InputFrookyConfig = { hookCollection: [nativeGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["free", "malloc"]);
      expect(warnSpy).toHaveBeenCalled();
      const [messageLines] = warnSpy.mock.calls[0] as [string[]];
      expect(messageLines[0]).toContain("Skipping hook for function with the symbol name 'bad' from module 'libc.so' due to an invalid declaration.");
    });

    it("skips a hook whose retType declaration is in an unrecognized format, without aborting the rest of the group", () => {
      const invalidRetTypeHook = { symbol: "bad", module: "libc.so", retType: 42 as unknown as string };
      const nativeGroup: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: [invalidRetTypeHook, "malloc"],
      };
      const config: InputFrookyConfig = { hookCollection: [nativeGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["malloc"]);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("still validates the remaining native hook groups after one group contained an unnormalizable hook", () => {
      const brokenGroup: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: [{ symbol: "bad", module: "libc.so", params: [123 as unknown as string] }],
      };
      const healthyGroup: InputNativeHookCollection = { type: "native", module: "libssl.so", hooks: ["SSL_write"] };
      const config: InputFrookyConfig = { hookCollection: [brokenGroup, healthyGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["SSL_write"]);
    });

    it("processes every hook independently, warning once per invalid hook without aborting the group", () => {
      const invalidHookA = { symbol: 1 as unknown as string, module: "libc.so" };
      const invalidHookB = { symbol: 2 as unknown as string, module: "libc.so" };
      const nativeGroup: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: [invalidHookA, "validSymbol", invalidHookB],
      };
      const config: InputFrookyConfig = { hookCollection: [nativeGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["validSymbol"]);
      expect(warnSpy.mock.calls.length).toBe(2);
    });
  });
});

export {};
