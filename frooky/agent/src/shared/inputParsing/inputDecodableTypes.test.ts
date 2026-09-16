import { Decodable as RetType, Param } from "../decoders/decodable";
import { DEFAULT_DECODER_SETTINGS } from "../defaultValues";
import { normalizeInputParam, normalizeInputRetType, normalizeInputRetTypeSettings } from "./inputDecodableTypes";
import { InputParamSettings } from "./inputSettings";

describe("inputDecodableTypes", () => {
  describe("normalizeInputParam()", () => {
    const inlineSettings: InputParamSettings = { direction: "out", maxRecursion: 10, decodeLimit: 10, fastDecode: false, magicDecode: true };
    const expectedSettings = { maxRecursion: 10, decodeLimit: 10, fastDecode: false, magicDecode: true };

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
      expect(normalizeInputRetType(["android.database.sqlite.SQLiteCursor", { decodeLimit: 10 }])).toEqual({
        type: "android.database.sqlite.SQLiteCursor",
        settings: { ...DEFAULT_DECODER_SETTINGS, decodeLimit: 10 },
      });
    });

    it("should return RetType unchanged", () => {
      const retType: RetType = { type: "int", settings: { ...DEFAULT_DECODER_SETTINGS, magicDecode: false } };
      expect(normalizeInputRetType(retType)).toEqual(retType);
    });
  });

  describe("normalizeInputRetTypeSettings()", () => {
    it("normalizes a bare decoder settings object", () => {
      expect(normalizeInputRetTypeSettings({ decodeLimit: 10 })).toEqual({ ...DEFAULT_DECODER_SETTINGS, decodeLimit: 10 });
    });

    it("merges a bare decoder settings object on top of the given base settings", () => {
      expect(normalizeInputRetTypeSettings({ decodeLimit: 10 }, { ...DEFAULT_DECODER_SETTINGS, maxRecursion: 30 })).toEqual({
        ...DEFAULT_DECODER_SETTINGS,
        maxRecursion: 30,
        decodeLimit: 10,
      });
    });

    it("ignores a plain type string, falling back to the base settings", () => {
      expect(normalizeInputRetTypeSettings("int", { ...DEFAULT_DECODER_SETTINGS, maxRecursion: 30 })).toEqual({
        ...DEFAULT_DECODER_SETTINGS,
        maxRecursion: 30,
      });
    });

    it("ignores the type in a [type, decoderSettings] tuple, keeping only the settings", () => {
      expect(normalizeInputRetTypeSettings(["int", { decodeLimit: 10 }])).toEqual({ ...DEFAULT_DECODER_SETTINGS, decodeLimit: 10 });
    });

    it("ignores the type in a normalized RetType object, keeping only the settings", () => {
      const retType: RetType = { type: "int", settings: { ...DEFAULT_DECODER_SETTINGS, magicDecode: false } };
      expect(normalizeInputRetTypeSettings(retType)).toEqual({ ...DEFAULT_DECODER_SETTINGS, magicDecode: false });
    });
  });
});

export {};
