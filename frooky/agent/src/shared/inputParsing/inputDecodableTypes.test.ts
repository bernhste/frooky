import { Decodable as RetType, Param } from "../decoders/decodable";
import { DEFAULT_DECODER_SETTINGS } from "../defaultValues";
import { normalizeInputParam, normalizeInputRetType } from "./inputDecodableTypes";
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
});

export {};
