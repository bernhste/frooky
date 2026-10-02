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
  // restored after each test, since some tests check that the defaults stay unchanged
  let pristineFrookySettings: FrookySettings;
  let warnSpy: Mock;

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
    warnSpy.mockRestore();
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
      version: 1,
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
      const [message] = warnSpy.mock.calls[0] as [string];
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
        callerFilter: ["a", "b"],
      };
      expect(validateAndRepairHookSettings(incompleteInputHookSettings)).toEqual({
        ...DEFAULT_HOOK_SETTINGS,
        callerFilter: ["a", "b"],
      });
    });

    it("resets a property to its default and warns when it does not match the schema", () => {
      const incorrectInputHookSettings: InputHookSettings = {
        maxStackFrames: "incorrect" as unknown as number,
        callerFilter: ["a", "b"],
      };
      expect(validateAndRepairHookSettings(incorrectInputHookSettings)).toEqual({
        ...DEFAULT_HOOK_SETTINGS,
        callerFilter: ["a", "b"],
      });

      expect(warnSpy).toHaveBeenCalled();
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain(`Hook setting "'maxStackFrames'" contains invalid data:`);
      expect(message).toContain(`The value for 'maxStackFrames' was reset to the default: ${DEFAULT_HOOK_SETTINGS.maxStackFrames}`);
    });

    it("drops invalid callerFilter patterns and warns", () => {
      const inputHookSettings: InputHookSettings = {
        callerFilter: ["^org\\.owasp\\.", "(unclosed", "[a-"],
      };
      expect(validateAndRepairHookSettings(inputHookSettings)).toEqual({
        ...DEFAULT_HOOK_SETTINGS,
        callerFilter: ["^org\\.owasp\\."],
      });
      expect(warnSpy).toHaveBeenCalledWith("Hook setting 'callerFilter' contains invalid regular expressions, which are ignored: (unclosed, [a-");
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
        maxItems: 30,
      };
      expect(validateAndRepairDecoderSettings(incompleteInputDecoderSettings)).toEqual({
        maxDepth: 10,
        maxItems: 30,
      });
    });

    it("resets a property to its default and warns when it does not match the schema", () => {
      const incorrectInputDecoderSettings: InputDecoderSettings = {
        maxItems: false as unknown as number,
      };
      expect(validateAndRepairDecoderSettings(incorrectInputDecoderSettings)).toEqual(DEFAULT_DECODER_SETTINGS);

      expect(warnSpy).toHaveBeenCalled();
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain(`Decoder setting "'maxItems'" contains invalid data:`);
      expect(message).toContain(`The value for 'maxItems' was reset to the default: ${String(DEFAULT_DECODER_SETTINGS.maxItems)}`);
    });

    for (const key of ["maxItems", "maxDepth"] as const) {
      for (const value of [0, -1]) {
        it(`resets ${key} to its default and warns when it is ${value}`, () => {
          expect(validateAndRepairDecoderSettings({ [key]: value })).toEqual(DEFAULT_DECODER_SETTINGS);

          expect(warnSpy).toHaveBeenCalled();
          const [message] = warnSpy.mock.calls[0] as [string];
          expect(message).toContain(`Decoder setting "'${key}'" contains invalid data:`);
        });
      }
    }

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

    it("does not modify the default settings (they are shared by every config, also across reloads)", () => {
      validateAndRepairFrookySettings({ hookSettings: { maxStackFrames: 42 }, decoderSettings: { maxDepth: 42 } });
      expect(DEFAULT_FROOKY_SETTINGS).toEqual(pristineFrookySettings);
    });

    it("repairs and merges hookSettings when provided, leaving decoderSettings at its default", () => {
      const result = validateAndRepairFrookySettings({ hookSettings: { maxStackFrames: 42 } });
      expect(result.hookSettings).toEqual({ ...pristineFrookySettings.hookSettings, maxStackFrames: 42 });
      expect(result.decoderSettings).toEqual(pristineFrookySettings.decoderSettings);
    });

    it("repairs and merges decoderSettings when provided, leaving hookSettings at its default", () => {
      const result = validateAndRepairFrookySettings({ decoderSettings: { maxDepth: 42 } });
      expect(result.decoderSettings).toEqual({ ...pristineFrookySettings.decoderSettings, maxDepth: 42 });
      expect(result.hookSettings).toEqual(pristineFrookySettings.hookSettings);
    });

    it("repairs both hookSettings and decoderSettings when both are provided", () => {
      const result = validateAndRepairFrookySettings({
        hookSettings: { maxStackFrames: 7 },
        decoderSettings: { maxItems: 42 },
      });
      expect(result.hookSettings).toEqual({ ...pristineFrookySettings.hookSettings, maxStackFrames: 7 });
      expect(result.decoderSettings).toEqual({ ...pristineFrookySettings.decoderSettings, maxItems: 42 });
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
        hookCollection: [],
      };
    }

    it("returns a valid config unchanged when it is already valid", () => {
      expect(validateAndRepairFrookyConfig(makeValidFrookyConfig(), "Android")).toEqual(makeValidFrookyConfig());
    });

    it("fills in default settings when none are provided", () => {
      const missingSettingsFrookyConfig: InputFrookyConfig = {
        metadata: { name: "Test Config", platform: "Android" },
        hookCollection: [],
      };
      expect(validateAndRepairFrookyConfig(missingSettingsFrookyConfig, "Android")).toEqual(makeValidFrookyConfig());
    });

    it("fills in default setting values when only partially set", () => {
      const partialSettingsFrookyConfig: InputFrookyConfig = {
        metadata: { name: "Test Config", platform: "Android" },
        settings: {
          hookSettings: { maxStackFrames: 55 },
          decoderSettings: { maxDepth: 20 },
        },
        hookCollection: [],
      };
      const expected: InputFrookyConfig = {
        metadata: { name: "Test Config", platform: "Android" },
        settings: {
          hookSettings: { ...pristineFrookySettings.hookSettings, maxStackFrames: 55 },
          decoderSettings: { ...pristineFrookySettings.decoderSettings, maxDepth: 20 },
        },
        hookCollection: [],
      };
      expect(validateAndRepairFrookyConfig(partialSettingsFrookyConfig, "Android")).toEqual(expected);
    });

    it("resets settings to their defaults when they do not match the schema", () => {
      const invalidSettingsFrookyConfig: InputFrookyConfig = {
        metadata: { name: "Test Config", platform: "Android" },
        settings: {
          hookSettings: { maxStackFrames: "10" as unknown as number },
          decoderSettings: { maxDepth: "10" as unknown as number },
        },
        hookCollection: [],
      };
      expect(validateAndRepairFrookyConfig(invalidSettingsFrookyConfig, "Android")).toEqual(makeValidFrookyConfig());
    });

    it("warns when the config contains unknown properties", () => {
      const configWithUnknownProperty = {
        myCustomSettings: {},
        metadata: { name: "Test Config", platform: "Android" },
        hookCollection: [],
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

    it("throws when no hookCollection is set", () => {
      expect(() => {
        validateAndRepairFrookyConfig({ metadata: { name: "Config w/o hookCollection" } } as InputFrookyConfig, "iOS");
      }).toThrow("Frooky config Config w/o hookCollection, as it has no 'hookCollection'.");
    });
  });
});

export {};
