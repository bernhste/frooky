import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { normalizeInputParams } from "../../shared/inputParsing/inputDecodableTypes";
import { InputJavaHookCollection, InputJavaHookDetails } from "../../shared/inputParsing/inputJavaHookCollection";
import { InputNativeHookCollection } from "../../shared/inputParsing/inputNativeHookCollection";
import { logger } from "../../shared/logger";
import { AndroidHookValidator } from "./androidHookValidator";

const defaultSettings: FrookySettings = {
  hookSettings: { ...DEFAULT_HOOK_SETTINGS },
  decoderSettings: { ...DEFAULT_DECODER_SETTINGS },
};

describe("AndroidHookValidator", () => {
  const validator = new AndroidHookValidator();

  describe("getPlatformHookCollections()", () => {
    it("returns an empty array for an empty hookCollection list", () => {
      const config: InputFrookyConfig = { hookCollection: [] };
      expect(validator.getPlatformHookCollections(config)).toEqual([]);
    });

    it("returns only the java hook collections from a mixed hookCollection list, preserving order", () => {
      const javaCollectionA: InputJavaHookCollection = { type: "java", javaClass: "com.example.A", hooks: [] };
      const nativeCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: [] };
      const javaCollectionB: InputJavaHookCollection = { type: "java", javaClass: "com.example.B", hooks: [] };
      const config: InputFrookyConfig = {
        hookCollection: [javaCollectionA, nativeCollection, javaCollectionB] as unknown as InputJavaHookCollection[],
      };

      expect(validator.getPlatformHookCollections(config)).toEqual([javaCollectionA, javaCollectionB]);
    });

    it("returns an empty array when there are no java hook collections", () => {
      const nativeCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: [] };
      const config: InputFrookyConfig = { hookCollection: [nativeCollection] as unknown as InputJavaHookCollection[] };

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

    it("returns an empty array when the config has no java hook collections", () => {
      const config: InputFrookyConfig = { hookCollection: [] };
      expect(validator.validateAndNormalizeHooks(config, defaultSettings)).toEqual([]);
    });

    it("normalizes a plain method-name hook into a full JavaHookDeclaration", () => {
      const javaCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.Foo", hooks: ["bar"] };
      const config: InputFrookyConfig = { hookCollection: [javaCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result).toEqual([
        { javaClass: "com.example.Foo", method: "bar", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS },
      ]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("collects hooks from multiple java hook collections, ignoring non-java hook collections", () => {
      const javaCollectionA: InputJavaHookCollection = { type: "java", javaClass: "com.example.A", hooks: ["foo"] };
      const nativeCollection: InputNativeHookCollection = { type: "native", module: "libc.so", hooks: ["bar"] };
      const javaCollectionB: InputJavaHookCollection = { type: "java", javaClass: "com.example.B", hooks: ["baz"] };
      const config: InputFrookyConfig = {
        hookCollection: [javaCollectionA, nativeCollection, javaCollectionB] as unknown as InputJavaHookCollection[],
      };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["foo", "baz"]);
    });

    it("skips a hook that fails schema validation, warns about it, and still keeps the valid hooks", () => {
      const invalidHook = { javaClass: "com.example.Foo", method: 123 as unknown as string };
      const javaCollection: InputJavaHookCollection = {
        type: "java",
        javaClass: "com.example.Foo",
        hooks: ["validMethod", invalidHook],
      };
      const config: InputFrookyConfig = { hookCollection: [javaCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["validMethod"]);
      expect(warnSpy).toHaveBeenCalled();
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("Skipping hook for java method '123' from class 'com.example.Foo' due to an invalid declaration:");
    });

    it("skips a hook whose overload param declaration is in an unrecognized format, without aborting the rest of the collection", () => {
      // a number is no valid param and makes normalization throw a plain Error, not a ZodError
      const invalidParamHook = {
        javaClass: "com.example.Foo",
        method: "bad",
        overloads: [{ params: [123 as unknown as string] }],
      };
      const javaCollection: InputJavaHookCollection = {
        type: "java",
        javaClass: "com.example.Foo",
        hooks: ["foo", invalidParamHook, "baz"],
      };
      const config: InputFrookyConfig = { hookCollection: [javaCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["foo", "baz"]);
      expect(warnSpy).toHaveBeenCalled();
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("Skipping hook for java method 'bad' from class 'com.example.Foo' due to an invalid declaration:");
    });

    it("skips a hook with a native decoder, naming the Java decoders", () => {
      const javaCollection: InputJavaHookCollection = {
        type: "java",
        javaClass: "com.example.Foo",
        hooks: ["foo", { method: "bar", overloads: [{ params: [["int", "fd", { decoder: "fd" }]] }] }],
      };

      const result = validator.validateAndNormalizeHooks({ hookCollection: [javaCollection] }, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["foo"]);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("decoder 'fd' is no Java decoder. The Java decoders are: string, base64, hashCode,");
    });

    it("warns about an unknown property and still installs the hook", () => {
      const javaCollection: InputJavaHookCollection = {
        type: "java",
        javaClass: "com.example.Foo",
        hooks: [{ method: "bar", overloads: [{ params: ["int"], retTyp: { maxDepth: 2 } }] } as unknown as InputJavaHookDetails],
      };

      const result = validator.validateAndNormalizeHooks({ hookCollection: [javaCollection] }, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["bar"]);
      expect(result[0].overloads?.[0]).toEqual({ params: normalizeInputParams(["int"]) });
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain(
        "Hook for java method 'bar' from class 'com.example.Foo' contains unknown properties, which are ignored: overloads[0].retTyp",
      );
    });

    it("still validates the remaining java hook collections after one collection contained an unnormalizable hook", () => {
      const brokenCollection: InputJavaHookCollection = {
        type: "java",
        javaClass: "com.example.Foo",
        hooks: [{ method: "bad", overloads: [{ params: [123 as unknown as string] }] }],
      };
      const healthyCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.Bar", hooks: ["baz"] };
      const config: InputFrookyConfig = { hookCollection: [brokenCollection, healthyCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["baz"]);
    });

    it("processes every hook independently, warning once per invalid hook without aborting the collection", () => {
      const invalidHookA = { javaClass: "com.example.Foo", method: 1 as unknown as string };
      const invalidHookB = { javaClass: "com.example.Foo", method: 2 as unknown as string };
      const javaCollection: InputJavaHookCollection = {
        type: "java",
        javaClass: "com.example.Foo",
        hooks: [invalidHookA, "validMethod", invalidHookB],
      };
      const config: InputFrookyConfig = { hookCollection: [javaCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["validMethod"]);
      expect(warnSpy.mock.calls.length).toBe(2);
    });

    it("warns and disables early setting on Java hooks", () => {
      const javaCollection: InputJavaHookCollection = {
        type: "java",
        javaClass: "com.example.Foo",
        hookSettings: { early: true },
        hooks: ["bar"],
      };
      const config: InputFrookyConfig = { hookCollection: [javaCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result[0].hookSettings?.early).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("Early hooking ('early: true') is not supported for Java method 'bar' from class 'com.example.Foo'");
    });
  });
});
