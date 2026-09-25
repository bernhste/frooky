import { Decodable as RetType, Param } from "../decoders/decodable";
import { DEFAULT_DECODER_SETTINGS } from "../defaultValues";
import { normalizeInputParam, normalizeInputRetType, normalizeInputRetTypeSettings } from "./inputDecodableTypes";
import { InputParamSettings } from "./inputSettings";

describe("inputDecodableTypes", () => {
  describe("normalizeInputParam()", () => {
    const inlineSettings: InputParamSettings = { direction: "out", maxDepth: 10, maxItems: 10, fastDecode: true };
    const expectedSettings = { maxDepth: 10, maxItems: 10, fastDecode: true, hashCode: false };

    it("should normalize a valid string to Param", () => {
      expect(normalizeInputParam("testParam")).toEqual({ type: "testParam", direction: "in", settings: DEFAULT_DECODER_SETTINGS });
    });

    it("should normalize [string, string] to a valid Param", () => {
      expect(normalizeInputParam(["testParam", "paramName"])).toEqual({
        type: "testParam",
        name: "paramName",
        direction: "in",
        settings: DEFAULT_DECODER_SETTINGS,
      });
    });

    it("should normalize a valid [string, InputParamSettings] to Param", () => {
      expect(normalizeInputParam(["testParam", inlineSettings])).toEqual({
        type: "testParam",
        direction: "out",
        settings: expectedSettings,
      });
    });

    it("should normalize to a valid [string, string, InputParamSettings] to Param", () => {
      expect(normalizeInputParam(["testParam", "paramName", inlineSettings])).toEqual({
        type: "testParam",
        name: "paramName",
        direction: "out",
        settings: expectedSettings,
      });
    });

    it("should return Param unchanged", () => {
      const param: Param = { type: "testParam", name: "paramName", direction: "out", settings: expectedSettings };
      expect(normalizeInputParam(param)).toEqual(param);
    });
  });

  describe("normalizeInputRetType()", () => {
    it("should normalize a valid string to a RetType", () => {
      expect(normalizeInputRetType("int")).toEqual({ type: "int", settings: DEFAULT_DECODER_SETTINGS });
    });

    it("should normalize a valid [string, Partial<DecoderSettings>] to a RetType", () => {
      expect(normalizeInputRetType(["android.database.sqlite.SQLiteCursor", { maxItems: 10 }])).toEqual({
        type: "android.database.sqlite.SQLiteCursor",
        settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 10 },
      });
    });

    it("should return RetType unchanged", () => {
      const retType: RetType = { type: "int", settings: { ...DEFAULT_DECODER_SETTINGS, fastDecode: true } };
      expect(normalizeInputRetType(retType)).toEqual(retType);
    });
  });

  describe("normalizeInputRetTypeSettings()", () => {
    it("normalizes a bare decoder settings object", () => {
      expect(normalizeInputRetTypeSettings({ maxItems: 10 })).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxItems: 10 });
    });

    it("merges a bare decoder settings object on top of the given base settings", () => {
      expect(normalizeInputRetTypeSettings({ maxItems: 10 }, { ...DEFAULT_DECODER_SETTINGS, maxDepth: 30 })).toEqual({
        ...DEFAULT_DECODER_SETTINGS,
        maxDepth: 30,
        maxItems: 10,
      });
    });

    it("ignores a plain type string, falling back to the base settings", () => {
      expect(normalizeInputRetTypeSettings("int", { ...DEFAULT_DECODER_SETTINGS, maxDepth: 30 })).toEqual({
        ...DEFAULT_DECODER_SETTINGS,
        maxDepth: 30,
      });
    });

    it("ignores the type in a [type, decoderSettings] tuple, keeping only the settings", () => {
      expect(normalizeInputRetTypeSettings(["int", { maxItems: 10 }])).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxItems: 10 });
    });

    it("ignores the type in a normalized RetType object, keeping only the settings", () => {
      const retType: RetType = { type: "int", settings: { ...DEFAULT_DECODER_SETTINGS, fastDecode: true } };
      expect(normalizeInputRetTypeSettings(retType)).toEqual({ ...DEFAULT_DECODER_SETTINGS, fastDecode: true });
    });
  });
});

export {};
