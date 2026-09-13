import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { InputJavaHookGroup } from "../../shared/inputParsing/inputJavaHookGroup";
import { InputNativeHookGroup } from "../../shared/inputParsing/inputNativeHookGroup";
import { logger } from "../../shared/logger";
import { AndroidHookValidator } from "./androidHookValidator";

const defaultSettings: FrookySettings = {
  hookSettings: { ...DEFAULT_HOOK_SETTINGS },
  decoderSettings: { ...DEFAULT_DECODER_SETTINGS },
};

describe("AndroidHookValidator", () => {
  const validator = new AndroidHookValidator();

  describe("getPlatformHookGroups()", () => {
    it("returns an empty array for an empty hookGroup list", () => {
      const config: InputFrookyConfig = { hookGroup: [] };
      expect(validator.getPlatformHookGroups(config)).toEqual([]);
    });

    it("returns only the java hook groups from a mixed hookGroup list, preserving order", () => {
      const javaGroupA: InputJavaHookGroup = { type: "java", javaClass: "com.example.A", hooks: [] };
      const nativeGroup: InputNativeHookGroup = { type: "native", module: "libc.so", hooks: [] };
      const javaGroupB: InputJavaHookGroup = { type: "java", javaClass: "com.example.B", hooks: [] };
      const config: InputFrookyConfig = { hookGroup: [javaGroupA, nativeGroup, javaGroupB] as unknown as InputJavaHookGroup[] };

      expect(validator.getPlatformHookGroups(config)).toEqual([javaGroupA, javaGroupB]);
    });

    it("returns an empty array when there are no java hook groups", () => {
      const nativeGroup: InputNativeHookGroup = { type: "native", module: "libc.so", hooks: [] };
      const config: InputFrookyConfig = { hookGroup: [nativeGroup] as unknown as InputJavaHookGroup[] };

      expect(validator.getPlatformHookGroups(config)).toEqual([]);
    });
  });

  describe("validateAndNormalizeHooks()", () => {
    let warnSpy: Spy;

    beforeEach(() => {
      warnSpy = spyOn(logger, "warn");
    });

    afterEach(() => {
      warnSpy.restore();
    });

    it("returns an empty array when the config has no java hook groups", () => {
      const config: InputFrookyConfig = { hookGroup: [] };
      expect(validator.validateAndNormalizeHooks(config, defaultSettings)).toEqual([]);
    });

    it("normalizes a plain method-name hook into a full InputJavaHookNormalized", () => {
      const javaGroup: InputJavaHookGroup = { type: "java", javaClass: "com.example.Foo", hooks: ["bar"] };
      const config: InputFrookyConfig = { hookGroup: [javaGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result).toEqual([
        { javaClass: "com.example.Foo", method: "bar", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS },
      ]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("collects hooks from multiple java hook groups, ignoring non-java hook groups", () => {
      const javaGroupA: InputJavaHookGroup = { type: "java", javaClass: "com.example.A", hooks: ["foo"] };
      const nativeGroup: InputNativeHookGroup = { type: "native", module: "libc.so", hooks: ["bar"] };
      const javaGroupB: InputJavaHookGroup = { type: "java", javaClass: "com.example.B", hooks: ["baz"] };
      const config: InputFrookyConfig = { hookGroup: [javaGroupA, nativeGroup, javaGroupB] as unknown as InputJavaHookGroup[] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["foo", "baz"]);
    });

    it("skips a hook that fails schema validation, warns about it, and still keeps the valid hooks", () => {
      const invalidHook = { javaClass: "com.example.Foo", method: 123 as unknown as string };
      const javaGroup: InputJavaHookGroup = {
        type: "java",
        javaClass: "com.example.Foo",
        hooks: ["validMethod", invalidHook],
      };
      const config: InputFrookyConfig = { hookGroup: [javaGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["validMethod"]);
      expect(warnSpy).toHaveBeenCalled();
      const [messageLines] = warnSpy.calls[0] as [string[]];
      expect(messageLines[0]).toContain("Skipping hook for java method '123' from class 'com.example.Foo' due to an invalid declaration.");
    });

    it("skips a hook whose overload param declaration is in an unrecognized format, without aborting the rest of the group", () => {
      // A bare number is not a valid InputParam shape (not a string, tuple, or Param object) and
      // makes normalization throw a plain Error rather than a ZodError - this must still be caught per-hook.
      const invalidParamHook = {
        javaClass: "com.example.Foo",
        method: "bad",
        overloads: [{ params: [123 as unknown as string] }],
      };
      const javaGroup: InputJavaHookGroup = {
        type: "java",
        javaClass: "com.example.Foo",
        hooks: ["foo", invalidParamHook, "baz"],
      };
      const config: InputFrookyConfig = { hookGroup: [javaGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["foo", "baz"]);
      expect(warnSpy).toHaveBeenCalled();
      const [messageLines] = warnSpy.calls[0] as [string[]];
      expect(messageLines[0]).toContain("Skipping hook for java method 'bad' from class 'com.example.Foo' due to an invalid declaration.");
    });

    it("skips a hook whose retType declaration is in an unrecognized format, without aborting the rest of the group", () => {
      const invalidRetTypeHook = { javaClass: "com.example.Foo", method: "bad", retType: 42 as unknown as string };
      const javaGroup: InputJavaHookGroup = {
        type: "java",
        javaClass: "com.example.Foo",
        hooks: [invalidRetTypeHook, "baz"],
      };
      const config: InputFrookyConfig = { hookGroup: [javaGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["baz"]);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("still validates the remaining java hook groups after one group contained an unnormalizable hook", () => {
      const brokenGroup: InputJavaHookGroup = {
        type: "java",
        javaClass: "com.example.Foo",
        hooks: [{ javaClass: "com.example.Foo", method: "bad", overloads: [{ params: [123 as unknown as string] }] }],
      };
      const healthyGroup: InputJavaHookGroup = { type: "java", javaClass: "com.example.Bar", hooks: ["baz"] };
      const config: InputFrookyConfig = { hookGroup: [brokenGroup, healthyGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["baz"]);
    });

    it("processes every hook independently, warning once per invalid hook without aborting the group", () => {
      const invalidHookA = { javaClass: "com.example.Foo", method: 1 as unknown as string };
      const invalidHookB = { javaClass: "com.example.Foo", method: 2 as unknown as string };
      const javaGroup: InputJavaHookGroup = {
        type: "java",
        javaClass: "com.example.Foo",
        hooks: [invalidHookA, "validMethod", invalidHookB],
      };
      const config: InputFrookyConfig = { hookGroup: [javaGroup] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["validMethod"]);
      expect(warnSpy.calls.length).toBe(2);
    });
  });
});
