import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { InputJavaHookCollection } from "../../shared/inputParsing/inputJavaHookCollection";
import { InputNativeHookCollection, InputNativeHookNormalized } from "../../shared/inputParsing/inputNativeHookCollection";
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

    it("returns only the native hook collections from a mixed hookCollection list, preserving order", () => {
      const nativeCollectionA: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: [] };
      const javaCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.A", hooks: [] };
      const nativeCollectionB: InputNativeHookCollection = { type: "native", module: "libssl.so", hooks: [] };
      const config: InputFrookyConfig = {
        hookCollection: [nativeCollectionA, javaCollection, nativeCollectionB] as unknown as InputNativeHookCollection[],
      };

      expect(validator.getPlatformHookCollections(config)).toEqual([nativeCollectionA, nativeCollectionB]);
    });

    it("returns an empty array when there are no native hook collections", () => {
      const javaCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.A", hooks: [] };
      const config: InputFrookyConfig = { hookCollection: [javaCollection] as unknown as InputNativeHookCollection[] };

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

    it("returns an empty array when the config has no native hook collections", () => {
      const config: InputFrookyConfig = { hookCollection: [] };
      expect(validator.validateAndNormalizeHooks(config, defaultSettings)).toEqual([]);
    });

    it("normalizes a plain symbol-name hook into a full InputNativeHookNormalized", () => {
      const nativeCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: ["malloc"] };
      const config: InputFrookyConfig = { hookCollection: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result).toEqual([
        { symbol: "malloc", module: "libc.so", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS },
      ]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("collects hooks from multiple native hook collections, ignoring non-native hook collections", () => {
      const nativeCollectionA: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: ["malloc"] };
      const javaCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.A", hooks: ["foo"] };
      const nativeCollectionB: InputNativeHookCollection = { type: "native", module: "libssl.so", hooks: ["SSL_write"] };
      const config: InputFrookyConfig = {
        hookCollection: [nativeCollectionA, javaCollection, nativeCollectionB] as unknown as InputNativeHookCollection[],
      };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["malloc", "SSL_write"]);
    });

    it("always uses the hook collection's module, ignoring a module set on the hook itself", () => {
      const nativeCollection: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: [{ symbol: "malloc", module: "libwrong.so" }],
      };
      const config: InputFrookyConfig = { hookCollection: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result[0].module).toBe("libc.so");
    });

    it("normalizes params and retType using the merged decoder settings", () => {
      const nativeCollection: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: [{ symbol: "memcpy", module: "libc.so", params: ["void *", "void *", "size_t"], retType: "void *" }],
      };
      const config: InputFrookyConfig = { hookCollection: [nativeCollection] };

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
      const nativeCollection: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: ["validSymbol", invalidHook],
      };
      const config: InputFrookyConfig = { hookCollection: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["validSymbol"]);
      expect(warnSpy).toHaveBeenCalled();
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("Skipping hook for native function '123' from module 'libc.so' due to an invalid declaration:");
    });

    it("normalizes a offset hook written as an unquoted YAML hex number", () => {
      const nativeCollection: InputNativeHookCollection = { type: "native", module: "libfoo.so", hooks: [{ offset: 0x1a2b4, module: "libfoo.so" }] };
      const config: InputFrookyConfig = { hookCollection: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.offset)).toEqual(["0x1a2b4"]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("skips a hook with an invalid offset and names the offset in the warning", () => {
      const nativeCollection: InputNativeHookCollection = {
        type: "native",
        module: "libfoo.so",
        hooks: ["validSymbol", { offset: "1a2b4", module: "libfoo.so" }],
      };
      const config: InputFrookyConfig = { hookCollection: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["validSymbol"]);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("Skipping hook for native function at offset '1a2b4' from module 'libfoo.so'");
    });

    it("skips a hook whose param declaration is in an unrecognized format, without aborting the rest of the collection", () => {
      // a number is no valid param and makes normalization throw a plain Error, not a ZodError
      const invalidParamHook = { symbol: "bad", module: "libc.so", params: [123 as unknown as string] };
      const nativeCollection: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: ["free", invalidParamHook, "malloc"],
      };
      const config: InputFrookyConfig = { hookCollection: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["free", "malloc"]);
      expect(warnSpy).toHaveBeenCalled();
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("Skipping hook for native function 'bad' from module 'libc.so' due to an invalid declaration:");
    });

    it("skips a hook whose decoderArgs role does not name another param", () => {
      const writeHook: InputNativeHookNormalized = {
        symbol: "write",
        module: "libc.so",
        params: ["int", ["const void *", "buf", { decoderArgs: { length: "count" }, decoder: "string" }], "size_t"],
      };
      const nativeCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: ["free", writeHook] };

      const result = validator.validateAndNormalizeHooks({ hookCollection: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["free"]);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("Skipping hook for native function 'write'");
      expect(message).toContain("'length: count' names no parameter");
    });

    it("skips a hook with decoder: errno on a param", () => {
      const unlinkHook: InputNativeHookNormalized = {
        symbol: "unlink",
        module: "libc.so",
        params: [["const char *", "path", { decoder: "errno" }]],
      };
      const nativeCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: ["free", unlinkHook] };

      const result = validator.validateAndNormalizeHooks({ hookCollection: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["free"]);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("decoder: errno on 'path' is only supported on the return value");
    });

    it("skips a hook with a Java decoder on its return value, naming the native decoders", () => {
      const getenvHook: InputNativeHookNormalized = { symbol: "getenv", module: "libc.so", retType: ["char *", { decoder: "hashCode" }] };
      const nativeCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: ["free", getenvHook] };

      const result = validator.validateAndNormalizeHooks({ hookCollection: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["free"]);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("decoder 'hashCode' is no native decoder. The native decoders are: string, utf16,");
    });

    it("skips a hook that passes a role its decoder doesn't accept", () => {
      const closeHook: InputNativeHookNormalized = {
        symbol: "close",
        module: "libc.so",
        params: [["int", "fd", { decoder: "fd", decoderArgs: { length: 1 } }]],
      };
      const nativeCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: ["free", closeHook] };

      const result = validator.validateAndNormalizeHooks({ hookCollection: [nativeCollection] }, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["free"]);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("decoder 'fd' doesn't accept the role 'length'. It accepts no decoderArgs.");
    });

    it("skips a hook whose retType declaration is in an unrecognized format, without aborting the rest of the collection", () => {
      const invalidRetTypeHook = { symbol: "bad", module: "libc.so", retType: 42 as unknown as string };
      const nativeCollection: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: [invalidRetTypeHook, "malloc"],
      };
      const config: InputFrookyConfig = { hookCollection: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["malloc"]);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("still validates the remaining native hook collections after one collection contained an unnormalizable hook", () => {
      const brokenCollection: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: [{ symbol: "bad", module: "libc.so", params: [123 as unknown as string] }],
      };
      const healthyCollection: InputNativeHookCollection = { type: "native", module: "libssl.so", hooks: ["SSL_write"] };
      const config: InputFrookyConfig = { hookCollection: [brokenCollection, healthyCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["SSL_write"]);
    });

    it("processes every hook independently, warning once per invalid hook without aborting the collection", () => {
      const invalidHookA = { symbol: 1 as unknown as string, module: "libc.so" };
      const invalidHookB = { symbol: 2 as unknown as string, module: "libc.so" };
      const nativeCollection: InputNativeHookCollection = {
        type: "native",
        module: "libc.so",
        hooks: [invalidHookA, "validSymbol", invalidHookB],
      };
      const config: InputFrookyConfig = { hookCollection: [nativeCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.symbol)).toEqual(["validSymbol"]);
      expect(warnSpy.mock.calls.length).toBe(2);
    });
  });
});

export {};
