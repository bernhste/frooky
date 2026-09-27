import { Decodable as RetType, Param } from "../decoders/decodable";
import { DEFAULT_DECODER_SETTINGS } from "../defaultValues";
import { normalizeInputParams, normalizeInputRetType, normalizeInputRetTypeSettings } from "./inputDecodableTypes";
import { InputParamSettings } from "./inputSettings";

describe("inputDecodableTypes", () => {
  describe("normalizeInputParams(), param formats", () => {
    const inlineSettings: InputParamSettings = { direction: "out", maxDepth: 10, maxItems: 10, hashCode: true };
    const expectedSettings = { maxDepth: 10, maxItems: 10, hashCode: true };

    it("should normalize a valid string to Param", () => {
      expect(normalizeInputParams(["testParam"])[0]).toEqual({ type: "testParam", direction: "in", settings: DEFAULT_DECODER_SETTINGS });
    });

    it("should normalize [string, string] to a valid Param", () => {
      expect(normalizeInputParams([["testParam", "paramName"]])[0]).toEqual({
        type: "testParam",
        name: "paramName",
        direction: "in",
        settings: DEFAULT_DECODER_SETTINGS,
      });
    });

    it("should normalize a valid [string, InputParamSettings] to Param", () => {
      expect(normalizeInputParams([["testParam", inlineSettings]])[0]).toEqual({
        type: "testParam",
        direction: "out",
        settings: expectedSettings,
      });
    });

    it("should normalize to a valid [string, string, InputParamSettings] to Param", () => {
      expect(normalizeInputParams([["testParam", "paramName", inlineSettings]])[0]).toEqual({
        type: "testParam",
        name: "paramName",
        direction: "out",
        settings: expectedSettings,
      });
    });

    it("should return Param unchanged", () => {
      const param: Param = { type: "testParam", name: "paramName", direction: "out", settings: expectedSettings };
      expect(normalizeInputParams([param])[0]).toEqual(param);
    });
  });

  describe("normalizeInputParams(), decoderArg references", () => {
    it("accepts a decoderArg that names another param", () => {
      const params = normalizeInputParams(["int", ["const void *", { decoderArg: "count" }], ["size_t", "count"]]);
      expect(params[1].settings.decoderArg).toBe("count");
      expect(params[2].name).toBe("count");
    });

    it("throws when no param has the decoderArg name", () => {
      expect(() => normalizeInputParams(["int", ["const void *", { decoderArg: "count" }], "size_t"])).toThrow(
        "decoderArg: no parameter named 'count' found. Name the parameter whose runtime value you want to pass to the decoder.",
      );
    });

    it("throws when decoderArg references the param itself", () => {
      expect(() => normalizeInputParams([["const void *", "buf", { decoderArg: "buf" }], "size_t"])).toThrow("refers to the parameter itself");
    });

    it("throws when decoderArg names more than one param", () => {
      expect(() =>
        normalizeInputParams([
          ["const void *", { decoderArg: "n" }],
          ["size_t", "n"],
          ["int", "n"],
        ]),
      ).toThrow("more than one parameter is named");
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
      const retType: RetType = { type: "int", settings: { ...DEFAULT_DECODER_SETTINGS, hashCode: true } };
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
      const retType: RetType = { type: "int", settings: { ...DEFAULT_DECODER_SETTINGS, hashCode: true } };
      expect(normalizeInputRetTypeSettings(retType)).toEqual({ ...DEFAULT_DECODER_SETTINGS, hashCode: true });
    });
  });
});

export {};
