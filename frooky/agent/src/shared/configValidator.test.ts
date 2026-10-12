import { validateDecoderSettings, validateFrookyConfig, validateHookSettings, validateInput, validateValueDecoderSettings } from "./configValidator";
import { DEFAULT_BASE_DECODER_SETTINGS, DEFAULT_DECODER_SETTINGS, DEFAULT_FROOKY_SETTINGS, DEFAULT_HOOK_SETTINGS } from "./defaultValues";
import { InputFrookyConfig } from "./frookyConfig";
import { InputDecoderSettings, InputHookSettings, InputParamSettings } from "./inputParsing/inputSettings";
import { inputParamSchema } from "./inputParsing/zodSchemas/inputDecodableTypes.zod";
import { logger } from "./logger";

describe("configValidator", () => {
  let warnSpy: Mock;

  beforeEach(() => {
    warnSpy = spyOn(logger, "warn");
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("validateHookSettings()", () => {
    it("returns the same settings when they already match the schema", () => {
      expect(validateHookSettings(DEFAULT_HOOK_SETTINGS)).toEqual(DEFAULT_HOOK_SETTINGS);
    });

    it("fills in the default value for a missing property", () => {
      expect(validateHookSettings({ callerFilter: ["a", "b"] })).toEqual({ ...DEFAULT_HOOK_SETTINGS, callerFilter: ["a", "b"] });
    });

    it("throws for a property that does not match the schema", () => {
      const settings: InputHookSettings = { maxStackFrames: "incorrect" as unknown as number };
      expect(() => validateHookSettings(settings)).toThrow("hookSettings is invalid:");
    });

    it("throws for a callerFilter pattern that is no regular expression", () => {
      const settings: InputHookSettings = { callerFilter: ["^org\\.owasp\\.", "(unclosed", "[a-"] };
      expect(() => validateHookSettings(settings)).toThrow("'callerFilter' contains invalid regular expressions: (unclosed, [a-");
    });

    it("throws for an unknown property", () => {
      const settings = { stackTraceLumit: 10 } as InputHookSettings;
      expect(() => validateHookSettings(settings)).toThrow("hookSettings contains unknown properties: stackTraceLumit");
    });

    it("doesn't modify the defaults, which every config shares", () => {
      validateHookSettings({ maxStackFrames: 42 });
      expect(DEFAULT_HOOK_SETTINGS.maxStackFrames).toBe(5);
    });
  });

  describe("validateDecoderSettings()", () => {
    it("returns the same settings when they already match the schema", () => {
      expect(validateDecoderSettings(DEFAULT_BASE_DECODER_SETTINGS)).toEqual({ maxDepth: 10, maxItems: 100 });
    });

    it("fills in the default value for a missing property", () => {
      expect(validateDecoderSettings({ maxItems: 30 })).toEqual({ maxDepth: 10, maxItems: 30 });
    });

    it("keeps decoder, which every level can set", () => {
      expect(validateDecoderSettings({ decoder: "hashCode" })).toEqual({ maxDepth: 10, maxItems: 100, decoder: "hashCode" });
    });

    for (const key of ["maxItems", "maxDepth"] as const) {
      for (const value of [0, -1, false]) {
        it(`throws when ${key} is ${value}`, () => {
          expect(() => validateDecoderSettings({ [key]: value } as InputDecoderSettings)).toThrow("decoderSettings is invalid:");
        });
      }
    }

    it("throws for the settings of a single parameter", () => {
      const settings = { maxItems: 5, argFilter: ["^a"], length: "len" } as InputDecoderSettings;
      expect(() => validateDecoderSettings(settings)).toThrow("decoderSettings contains unknown properties: argFilter, length");
    });
  });

  describe("validateValueDecoderSettings()", () => {
    it("keeps the settings that only a parameter can have", () => {
      const settings: InputParamSettings = {
        decoder: "bitmask",
        argFilter: ["^a"],
        length: "len",
        offset: 4,
        decoderOptions: { constants: { A: 1 } },
      };

      expect(validateValueDecoderSettings(settings)).toEqual({ maxDepth: 10, maxItems: 100, ...settings });
    });

    it("fills in the default value for a missing property", () => {
      expect(validateValueDecoderSettings({ argFilter: ["^a"] })).toEqual({ maxDepth: 10, maxItems: 100, argFilter: ["^a"] });
      expect(validateValueDecoderSettings({})).toEqual({ maxDepth: DEFAULT_DECODER_SETTINGS.maxDepth, maxItems: DEFAULT_DECODER_SETTINGS.maxItems });
    });

    it("throws for a property that does not match the schema", () => {
      expect(() => validateValueDecoderSettings({ argFilter: "^a" as unknown as string[] })).toThrow("decoder settings is invalid:");
    });

    it("throws for an unknown property", () => {
      expect(() => validateValueDecoderSettings({ lenght: 3 } as InputParamSettings)).toThrow("decoder settings contains unknown properties: lenght");
    });
  });

  describe("types of the settings", () => {
    it("accepts only whole numbers for maxStackFrames, maxItems and maxDepth", () => {
      expect(validateHookSettings({ maxStackFrames: 0 }).maxStackFrames).toBe(0);
      expect(validateDecoderSettings({ maxItems: 1, maxDepth: 1 })).toEqual({ ...DEFAULT_BASE_DECODER_SETTINGS, maxItems: 1, maxDepth: 1 });
      for (const value of [1.5, -1, "5", true, null, NaN, Infinity]) {
        expect(() => validateHookSettings({ maxStackFrames: value } as unknown as InputHookSettings)).toThrow("hookSettings is invalid");
        expect(() => validateDecoderSettings({ maxItems: value } as unknown as InputDecoderSettings)).toThrow();
        expect(() => validateDecoderSettings({ maxDepth: value } as unknown as InputDecoderSettings)).toThrow();
      }
      expect(() => validateDecoderSettings({ maxItems: 0 })).toThrow();
    });

    it("accepts only booleans for javaStackTrace, nativeStackTrace and early", () => {
      for (const setting of ["javaStackTrace", "nativeStackTrace", "early"]) {
        expect(validateHookSettings({ [setting]: true })[setting as "early"]).toBe(true);
        for (const value of ["true", "yes", "on", 1, 0, null, []]) {
          expect(() => validateHookSettings({ [setting]: value } as unknown as InputHookSettings)).toThrow("hookSettings is invalid");
        }
      }
    });

    it("rejects an empty callerFilter pattern", () => {
      expect(() => validateHookSettings({ callerFilter: [""] })).toThrow("hookSettings is invalid");
      expect(() => validateHookSettings({ callerFilter: "^a" } as unknown as InputHookSettings)).toThrow("hookSettings is invalid");
    });

    it("accepts only a pattern of field names for decoderOptions.fields", () => {
      const withFields = (fields: string) => validateValueDecoderSettings({ decoder: "constants", decoderOptions: { fields } });

      expect(withFields("*_MODE").decoderOptions?.fields).toBe("*_MODE");
      for (const fields of ["", "A B", "FLAG_.*", "a,b"]) expect(() => withFields(fields)).toThrow();
    });
  });

  describe("validateInput()", () => {
    it("returns the input when it matches the schema", () => {
      expect(validateInput(inputParamSchema, ["int", "len", { direction: "out" }], "The param")).toEqual(["int", "len", { direction: "out" }]);
    });

    it("throws for input that doesn't match the schema", () => {
      expect(() => validateInput(inputParamSchema, 42, "The param")).toThrow("The param is invalid:");
    });

    it("throws for unknown properties, with their paths", () => {
      expect(() => validateInput(inputParamSchema, ["int", "len", { decoderArgs: { length: 3 } }], "The param")).toThrow(
        "The param contains unknown properties: [2].decoderArgs",
      );
      expect(() => validateInput(inputParamSchema, { type: "int", settings: { maxItems: 3 } }, "The param")).toThrow(
        "The param contains unknown properties: settings",
      );
    });
  });

  describe("validateFrookyConfig()", () => {
    const metadata = { name: "Test Config", platform: "Android" } as const;

    it("returns the default settings when the file sets none", () => {
      expect(validateFrookyConfig({ metadata, hookCollections: [] }, "Android")).toEqual({
        hookSettings: DEFAULT_HOOK_SETTINGS,
        decoderSettings: { maxDepth: 10, maxItems: 100 },
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("fills in default setting values when only partially set", () => {
      const config: InputFrookyConfig = {
        schemaVersion: 1,
        metadata,
        hookSettings: { maxStackFrames: 55 },
        decoderSettings: { maxDepth: 20 },
        hookCollections: [],
      };
      expect(validateFrookyConfig(config, "Android")).toEqual({
        hookSettings: { ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 55 },
        decoderSettings: { maxDepth: 20, maxItems: 100 },
      });
    });

    it("doesn't modify the default settings (they are shared by every config, also across reloads)", () => {
      validateFrookyConfig({ hookSettings: { maxStackFrames: 42 }, decoderSettings: { maxDepth: 42 }, hookCollections: [] }, "Android");
      expect(DEFAULT_FROOKY_SETTINGS.hookSettings.maxStackFrames).toBe(5);
      expect(DEFAULT_FROOKY_SETTINGS.decoderSettings.maxDepth).toBe(10);
    });

    it("throws for settings that do not match the schema", () => {
      const config: InputFrookyConfig = { hookSettings: { maxStackFrames: "10" as unknown as number }, hookCollections: [] };
      expect(() => validateFrookyConfig(config, "Android")).toThrow("The hook file is invalid:");
      expect(() => validateFrookyConfig({ hookSettings: true, hookCollections: [] } as unknown as InputFrookyConfig, "Android")).toThrow(
        "The hook file is invalid:",
      );
    });

    it("throws for the settings of a single parameter in the file's decoderSettings", () => {
      const config = { decoderSettings: { maxDepth: 42, argFilter: ["^a"] }, hookCollections: [] } as InputFrookyConfig;
      expect(() => validateFrookyConfig(config, "Android")).toThrow("The hook file contains unknown properties: decoderSettings.argFilter");
    });

    it("throws for unknown properties", () => {
      const config = { settings: {}, hookCollections: [] } as unknown as InputFrookyConfig;
      expect(() => validateFrookyConfig(config, "Android")).toThrow("The hook file contains unknown properties: settings");
    });

    it("accepts metadata fields it doesn't know", () => {
      const config = { metadata: { ...metadata, team: "red", masvs: ["CRYPTO-1"] }, hookCollections: [] } as unknown as InputFrookyConfig;
      expect(() => validateFrookyConfig(config, "Android")).not.toThrow();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns about metadata that does not match the schema, and still loads the file", () => {
      const config = { metadata: { category: true }, hookCollections: [] } as unknown as InputFrookyConfig;
      expect(() => validateFrookyConfig(config, "Android")).not.toThrow();
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("The metadata contains invalid entries:");
    });

    it("throws for a schemaVersion it doesn't read", () => {
      const config = { schemaVersion: 2, hookCollections: [] } as unknown as InputFrookyConfig;
      expect(() => validateFrookyConfig(config, "Android")).toThrow(
        "'schemaVersion: 2' is not supported. This version of frooky reads schemaVersion 1.",
      );
    });

    it("warns when the declared platform is another one", () => {
      validateFrookyConfig({ metadata, hookCollections: [] }, "iOS");
      expect(warnSpy).toHaveBeenCalledWith(
        "The platform declared in the frooky configuration does not match the actual platform (iOS). Not all hooks may be valid.",
      );
    });

    it("doesn't warn when no platform is declared", () => {
      validateFrookyConfig({ metadata: { name: "Test" }, hookCollections: [] }, "Android");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("throws when hookCollections is missing or no list", () => {
      expect(() => validateFrookyConfig({ metadata } as InputFrookyConfig, "iOS")).toThrow(
        "'hookCollections' must be a list of hook collections, but is missing.",
      );
      expect(() => validateFrookyConfig({ hookCollections: {} } as unknown as InputFrookyConfig, "iOS")).toThrow(
        "'hookCollections' must be a list of hook collections, but is {}.",
      );
    });
  });
});

export {};
