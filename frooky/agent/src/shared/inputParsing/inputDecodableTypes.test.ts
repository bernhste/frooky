import { Decodable as RetType, Param } from "../decoders/decodable";
import { DEFAULT_DECODER_SETTINGS } from "../defaultValues";
import { InputRetTypeSettings, normalizeInputParams, normalizeInputRetType, normalizeInputRetTypeSettings } from "./inputDecodableTypes";
import { InputParamSettings } from "./inputSettings";

describe("inputDecodableTypes", () => {
  describe("normalizeInputParams(), param formats", () => {
    const inlineSettings: InputParamSettings = { direction: "out", maxDepth: 10, maxItems: 10 };
    const expectedSettings = { maxDepth: 10, maxItems: 10 };

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

    it("should keep a complete Param as it is", () => {
      const param: Param = { type: "testParam", name: "paramName", direction: "out", settings: expectedSettings };
      expect(normalizeInputParams([param])[0]).toEqual(param);
    });

    it("should complete an object with only type and name", () => {
      const input = { type: "java.lang.String", name: "action" } as Param;
      expect(normalizeInputParams([input])[0]).toEqual({
        type: "java.lang.String",
        name: "action",
        direction: "in",
        settings: DEFAULT_DECODER_SETTINGS,
      });
    });

    it("should throw for an object without a type", () => {
      expect(() => normalizeInputParams([{ name: "action" } as unknown as Param])).toThrow("Unrecognized InputParam format");
    });

    it("should throw when inputs is not an array", () => {
      expect(() => normalizeInputParams(undefined as unknown as Param[])).toThrow("Expected 'params' to be an array");
    });
  });

  describe("normalizeInputParams(), settings precedence", () => {
    // the merged file, group and hook level settings
    const outerSettings = { ...DEFAULT_DECODER_SETTINGS, maxDepth: 30, maxItems: 30 };

    it("uses the outer settings for the forms without own settings", () => {
      const params = normalizeInputParams(["int", ["int", "n"]], outerSettings);
      for (const param of params) expect(param.settings).toEqual(outerSettings);
    });

    it("lets the param's own settings override the outer ones field by field, in every form", () => {
      const params = normalizeInputParams(
        [["int", { maxItems: 5 }], ["int", "n", { maxItems: 5 }], { type: "int", settings: { maxItems: 5 } } as Param],
        outerSettings,
      );
      for (const param of params) expect(param.settings).toEqual({ ...outerSettings, maxItems: 5 });
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
      const retType: RetType = { type: "int", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 30 } };
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

    it("rejects a plain type string", () => {
      expect(() => normalizeInputRetTypeSettings("int" as unknown as InputRetTypeSettings)).toThrow("Unrecognized InputRetTypeSettings format");
    });

    it("rejects a [type, decoderSettings] tuple", () => {
      expect(() => normalizeInputRetTypeSettings(["int", { maxItems: 10 }] as unknown as InputRetTypeSettings)).toThrow(
        "Unrecognized InputRetTypeSettings format",
      );
    });

    it("rejects an object with a type property", () => {
      const retType = { type: "int", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 30 } };
      expect(() => normalizeInputRetTypeSettings(retType as unknown as InputRetTypeSettings)).toThrow("Unrecognized InputRetTypeSettings format");
    });
  });
});

export {};
