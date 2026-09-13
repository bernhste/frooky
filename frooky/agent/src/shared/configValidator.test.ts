import {
  validateAndRepairDecoderSettings,
  validateAndRepairFrookyConfig,
  validateAndRepairFrookySettings,
  validateAndRepairHookSettings,
  validateMetadata,
} from "./configValidator";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_FROOKY_SETTINGS, DEFAULT_HOOK_SETTINGS } from "./defaultValues";
import { InputFrookyConfig } from "./frookyConfig";
import { FrookyMetadata } from "./frookyMetadata";
import { FrookySettings } from "./frookySettings";
import { InputDecoderSettings, InputHookSettings } from "./inputParsing/inputSettings";
import { logger } from "./logger";

describe("configValidator", () => {
  // validateAndRepairFrookySettings() mutates DEFAULT_FROOKY_SETTINGS.hookSettings/.decoderSettings
  // in place, so every test restores it from this snapshot to stay isolated regardless of run order.
  let pristineFrookySettings: FrookySettings;
  let warnSpy: Spy;

  beforeAll(() => {
    pristineFrookySettings = {
      hookSettings: { ...DEFAULT_FROOKY_SETTINGS.hookSettings },
      decoderSettings: { ...DEFAULT_FROOKY_SETTINGS.decoderSettings },
    };
  });

  beforeEach(() => {
    warnSpy = spyOn(logger, "warn");
  });

  afterEach(() => {
    warnSpy.restore();
    DEFAULT_FROOKY_SETTINGS.hookSettings = { ...pristineFrookySettings.hookSettings };
    DEFAULT_FROOKY_SETTINGS.decoderSettings = { ...pristineFrookySettings.decoderSettings };
  });

  describe("validateMetadata()", () => {
    const validMetadata: FrookyMetadata = {
      platform: "Android",
      name: "Test",
      description: "Test description",
      category: "Test category",
      author: "frooky devs",
      version: "1.0",
    };

    it("does not warn when the metadata matches the schema and platform", () => {
      validateMetadata(validMetadata, "Android");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns on a platform mismatch", () => {
      validateMetadata(validMetadata, "iOS");
      expect(warnSpy).toHaveBeenCalledWith(
        "The platform declared in the frooky configuration does not match the actual platform (iOS). Not all hooks may be valid.",
      );
    });

    it("warns when no platform is declared in the metadata", () => {
      validateMetadata({ name: "Test" }, "Android");
      expect(warnSpy).toHaveBeenCalledWith(
        "The platform declared in the frooky configuration does not match the actual platform (Android). Not all hooks may be valid.",
      );
    });

    it("warns if the metadata does not match the schema", () => {
      const invalidMetadata = { ...validMetadata, category: true as unknown as string };
      validateMetadata(invalidMetadata, "Android");
      expect(warnSpy).toHaveBeenCalled();
      const [message] = warnSpy.calls[0] as [string];
      expect(message).toContain("The metadata contains invalid entries");
    });
  });

  describe("validateAndRepairHookSettings()", () => {
    it("returns the same settings when they already match the schema", () => {
      expect(validateAndRepairHookSettings(DEFAULT_HOOK_SETTINGS)).toEqual(DEFAULT_HOOK_SETTINGS);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("fills in the default value for a missing property", () => {
      const incompleteInputHookSettings: InputHookSettings = {
        stackTraceFilter: ["a", "b"],
      };
      expect(validateAndRepairHookSettings(incompleteInputHookSettings)).toEqual({
        stackTraceLimit: DEFAULT_HOOK_SETTINGS.stackTraceLimit,
        stackTraceFilter: ["a", "b"],
      });
    });

    it("resets a property to its default and warns when it does not match the schema", () => {
      const incorrectInputHookSettings: InputHookSettings = {
        stackTraceLimit: "incorrect" as unknown as number,
        stackTraceFilter: ["a", "b"],
      };
      expect(validateAndRepairHookSettings(incorrectInputHookSettings)).toEqual({
        stackTraceLimit: DEFAULT_HOOK_SETTINGS.stackTraceLimit,
        stackTraceFilter: ["a", "b"],
      });

      expect(warnSpy).toHaveBeenCalled();
      const [lines] = warnSpy.calls[0] as [string[]];
      expect(lines).toContain(`Hook setting "'stackTraceLimit'" contains invalid data:`);
      expect(lines).toContain(`The value for 'stackTraceLimit' was reset to the default: ${DEFAULT_HOOK_SETTINGS.stackTraceLimit}`);
    });

    it("warns when the settings contain unknown properties", () => {
      const invalidInputHookSettings = { stackTraceLumit: 10 };
      validateAndRepairHookSettings(invalidInputHookSettings as InputHookSettings);
      expect(warnSpy).toHaveBeenCalledWith("Hook settings contain unknown properties: stackTraceLumit");
    });
  });

  describe("validateAndRepairDecoderSettings()", () => {
    it("returns the same settings when they already match the schema", () => {
      expect(validateAndRepairDecoderSettings(DEFAULT_DECODER_SETTINGS)).toEqual(DEFAULT_DECODER_SETTINGS);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("fills in the default value for a missing property", () => {
      const incompleteInputDecoderSettings: InputDecoderSettings = {
        decodeLimit: 30,
      };
      expect(validateAndRepairDecoderSettings(incompleteInputDecoderSettings)).toEqual({
        fastDecode: false,
        magicDecode: false,
        maxRecursion: 10,
        decodeLimit: 30,
      });
    });

    it("resets a property to its default and warns when it does not match the schema", () => {
      const incorrectInputDecoderSettings: InputDecoderSettings = {
        decodeLimit: false as unknown as number,
      };
      expect(validateAndRepairDecoderSettings(incorrectInputDecoderSettings)).toEqual(DEFAULT_DECODER_SETTINGS);

      expect(warnSpy).toHaveBeenCalled();
      const [lines] = warnSpy.calls[0] as [string[]];
      expect(lines).toContain(`Decoder setting "'decodeLimit'" contains invalid data:`);
      expect(lines).toContain(`The value for 'decodeLimit' was reset to the default: ${String(DEFAULT_DECODER_SETTINGS.decodeLimit)}`);
    });

    it("warns when the settings contain unknown properties", () => {
      const unknownInputDecoderSettings = { someOtherSetting: false };
      validateAndRepairDecoderSettings(unknownInputDecoderSettings as InputDecoderSettings);
      expect(warnSpy).toHaveBeenCalledWith("Decoder settings contain unknown properties: someOtherSetting");
    });
  });

  describe("validateAndRepairFrookySettings()", () => {
    it("returns the defaults when no settings are provided", () => {
      expect(validateAndRepairFrookySettings({})).toEqual(pristineFrookySettings);
    });

    it("repairs and merges hookSettings when provided, leaving decoderSettings at its default", () => {
      const result = validateAndRepairFrookySettings({ hookSettings: { stackTraceLimit: 42 } });
      expect(result.hookSettings).toEqual({ ...pristineFrookySettings.hookSettings, stackTraceLimit: 42 });
      expect(result.decoderSettings).toEqual(pristineFrookySettings.decoderSettings);
    });

    it("repairs and merges decoderSettings when provided, leaving hookSettings at its default", () => {
      const result = validateAndRepairFrookySettings({ decoderSettings: { magicDecode: true } });
      expect(result.decoderSettings).toEqual({ ...pristineFrookySettings.decoderSettings, magicDecode: true });
      expect(result.hookSettings).toEqual(pristineFrookySettings.hookSettings);
    });

    it("repairs both hookSettings and decoderSettings when both are provided", () => {
      const result = validateAndRepairFrookySettings({
        hookSettings: { stackTraceLimit: 7 },
        decoderSettings: { fastDecode: true },
      });
      expect(result.hookSettings).toEqual({ ...pristineFrookySettings.hookSettings, stackTraceLimit: 7 });
      expect(result.decoderSettings).toEqual({ ...pristineFrookySettings.decoderSettings, fastDecode: true });
    });
  });

  describe("validateAndRepairFrookyConfig()", () => {
    function makeValidFrookyConfig(): InputFrookyConfig {
      return {
        metadata: { name: "Test Config", platform: "Android" },
        settings: {
          hookSettings: { ...pristineFrookySettings.hookSettings },
          decoderSettings: { ...pristineFrookySettings.decoderSettings },
        },
        hookGroup: [],
      };
    }

    it("returns a valid config unchanged when it is already valid", () => {
      expect(validateAndRepairFrookyConfig(makeValidFrookyConfig(), "Android")).toEqual(makeValidFrookyConfig());
    });

    it("fills in default settings when none are provided", () => {
      const missingSettingsFrookyConfig: InputFrookyConfig = {
        metadata: { name: "Test Config", platform: "Android" },
        hookGroup: [],
      };
      expect(validateAndRepairFrookyConfig(missingSettingsFrookyConfig, "Android")).toEqual(makeValidFrookyConfig());
    });

    it("fills in default setting values when only partially set", () => {
      const partialSettingsFrookyConfig: InputFrookyConfig = {
        metadata: { name: "Test Config", platform: "Android" },
        settings: {
          hookSettings: { stackTraceLimit: 55 },
          decoderSettings: { magicDecode: false },
        },
        hookGroup: [],
      };
      const expected: InputFrookyConfig = {
        metadata: { name: "Test Config", platform: "Android" },
        settings: {
          hookSettings: { ...pristineFrookySettings.hookSettings, stackTraceLimit: 55 },
          decoderSettings: { ...pristineFrookySettings.decoderSettings, magicDecode: false },
        },
        hookGroup: [],
      };
      expect(validateAndRepairFrookyConfig(partialSettingsFrookyConfig, "Android")).toEqual(expected);
    });

    it("resets settings to their defaults when they do not match the schema", () => {
      const invalidSettingsFrookyConfig: InputFrookyConfig = {
        metadata: { name: "Test Config", platform: "Android" },
        settings: {
          hookSettings: { stackTraceLimit: "10" as unknown as number },
          decoderSettings: { fastDecode: 10 as unknown as boolean },
        },
        hookGroup: [],
      };
      expect(validateAndRepairFrookyConfig(invalidSettingsFrookyConfig, "Android")).toEqual(makeValidFrookyConfig());
    });

    it("warns when the config contains unknown properties", () => {
      const configWithUnknownProperty = {
        myCustomSettings: {},
        metadata: { name: "Test Config", platform: "Android" },
        hookGroup: [],
      };
      validateAndRepairFrookyConfig(configWithUnknownProperty as InputFrookyConfig, "Android");
      expect(warnSpy).toHaveBeenCalledWith("Frooky config contains unknown properties: myCustomSettings");
    });

    it("warns on an OS mismatch via validateMetadata()", () => {
      validateAndRepairFrookyConfig(makeValidFrookyConfig(), "iOS");
      expect(warnSpy).toHaveBeenCalledWith(
        "The platform declared in the frooky configuration does not match the actual platform (iOS). Not all hooks may be valid.",
      );
    });

    it("throws when no hookGroup is set", () => {
      expect(() => {
        validateAndRepairFrookyConfig({ metadata: { name: "Config w/o hookGroup" } } as InputFrookyConfig, "iOS");
      }).toThrow("Frooky config Config w/o hookGroup, as it has no 'hookGroup'.");
    });
  });
});

export {};
