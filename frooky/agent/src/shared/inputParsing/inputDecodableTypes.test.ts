import { Decodable as RetType, Param } from "../decoders/decodable";
import { DEFAULT_DECODER_SETTINGS } from "../defaultValues";
import {
  normalizeInputParams,
  normalizeInputRetType,
  normalizeInputRetTypeSettings,
  validateDecoderArgRoles,
  validateDecoderConfig,
  validateDecoderNames,
} from "./inputDecodableTypes";
import { InputParamSettings } from "./inputSettings";
import { inputParamSchema, inputRetTypeSettingsSchema } from "./zodSchemas/inputDecodableTypes.zod";

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

    it("is rejected by the schema for an object without a type", () => {
      expect(inputParamSchema.safeParse({ name: "action" }).success).toBe(false);
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

  describe("normalizeInputParams(), decoderArgs", () => {
    it("accepts the roles with another param, a number or the return value", () => {
      const params = normalizeInputParams([
        ["[B", "key", { decoderArgs: { offset: "offset", length: 16 } }],
        ["int", "offset"],
        ["void *", "buf", { direction: "out", decoderArgs: { length: "$ret" } }],
      ]);
      expect(params[0].settings.decoderArgs).toEqual({ offset: "offset", length: 16 });
      expect(params[2].settings.decoderArgs).toEqual({ length: "$ret" });
    });

    it("throws for decoderArg, which is no setting", () => {
      expect(() =>
        normalizeInputParams([
          ["const void *", "buf", { decoderArg: "count" } as never],
          ["size_t", "count"],
        ]),
      ).toThrow("'decoderArg' is no decoder setting. Pass the value by its role, e.g. 'decoderArgs: { length: len }' on 'buf'.");
    });

    it("throws for an unknown role", () => {
      expect(() =>
        normalizeInputParams([
          ["const void *", "buf", { decoderArgs: { size: "count" } as never }],
          ["size_t", "count"],
        ]),
      ).toThrow("decoderArgs of 'buf': 'size' is no role. The roles are: length, offset.");
    });

    it("throws when no param has the name", () => {
      expect(() => normalizeInputParams(["int", ["const void *", "buf", { decoderArgs: { length: "count" } }], "size_t"])).toThrow(
        "decoderArgs of 'buf': 'length: count' names no parameter. Use the name of another parameter, '$ret' or a number.",
      );
    });

    it("throws for a number that is no count", () => {
      expect(() => normalizeInputParams([["const void *", "buf", { decoderArgs: { length: -1 } }]])).toThrow("must be a non-negative integer");
      expect(() => normalizeInputParams([["const void *", "buf", { decoderArgs: { offset: 1.5 } }]])).toThrow("must be a non-negative integer");
    });

    it("throws when a role names the param itself", () => {
      expect(() => normalizeInputParams([["const void *", "buf", { decoderArgs: { length: "buf" } }], "size_t"])).toThrow("is the parameter itself");
    });

    it("throws when a role names more than one param", () => {
      expect(() =>
        normalizeInputParams([
          ["const void *", { decoderArgs: { length: "n" } }],
          ["size_t", "n"],
          ["int", "n"],
        ]),
      ).toThrow("more than one parameter is named");
    });

    it("throws when the return value is passed to a param decoded on entry", () => {
      expect(() => normalizeInputParams(["int", ["void *", "buf", { decoderArgs: { length: "$ret" } }]])).toThrow("Set 'direction: out' on 'buf'");
      expect(() => normalizeInputParams(["int", ["void *", "buf", { direction: "inout", decoderArgs: { length: "$ret" } }]])).toThrow(
        "Set 'direction: out'",
      );
    });
  });

  describe("validateDecoderArgRoles()", () => {
    const params = normalizeInputParams([["[B", "key", { decoderArgs: { offset: 1, length: 2 } }], "int"]);

    it("accepts roles the decoder accepts", () => {
      expect(() => validateDecoderArgRoles(params, () => ["length", "offset"])).not.toThrow();
    });

    it("throws for a role the decoder doesn't accept, naming the accepted ones", () => {
      expect(() => validateDecoderArgRoles(params, () => ["length"])).toThrow(
        "decoderArgs of 'key': the decoder of '[B' doesn't accept the role 'offset'. It accepts: length.",
      );
      expect(() => validateDecoderArgRoles(params, () => [])).toThrow("doesn't accept the roles 'offset', 'length'. It accepts no decoderArgs.");
    });
  });

  describe("validateDecoderConfig()", () => {
    const withConstants = { ...DEFAULT_DECODER_SETTINGS, config: { constants: { A: 1 } } };
    const acceptsConstants = () => ["constants"];

    it("accepts options the decoder accepts, and values without config", () => {
      expect(() =>
        validateDecoderConfig(
          [
            ["mode", { ...withConstants, decoder: "bitmask" }],
            ["len", DEFAULT_DECODER_SETTINGS],
            ["return value", undefined],
          ],
          acceptsConstants,
        ),
      ).not.toThrow();
    });

    it("throws for an option the decoder doesn't accept, naming the value and the decoder", () => {
      expect(() => validateDecoderConfig([["data", { ...withConstants, decoder: "base64" }]], () => [])).toThrow(
        "config of 'data': decoder 'base64' doesn't accept 'constants'. It accepts no config.",
      );
    });

    it("throws for config without a decoder, naming the decoder of the type", () => {
      expect(() => validateDecoderConfig([["return value", withConstants]], () => [])).toThrow(
        "config of 'return value': the decoder of its type doesn't accept 'constants'. It accepts no config.",
      );
    });

    it("lists the accepted options", () => {
      const settings = { ...DEFAULT_DECODER_SETTINGS, decoder: "constants" as const, config: { constants: { A: 1 }, other: 1 } as never };
      expect(() => validateDecoderConfig([["mode", settings]], acceptsConstants)).toThrow(
        "config of 'mode': decoder 'constants' doesn't accept 'other'. It accepts: constants.",
      );
    });
  });

  describe("validateDecoderNames()", () => {
    it("accepts the platform's decoders and settings without a decoder", () => {
      expect(() => validateDecoderNames([{ decoder: "string" }, {}, undefined], ["string", "fd"], "native")).not.toThrow();
    });

    it("throws for a decoder of another platform, listing the platform's decoders", () => {
      expect(() => validateDecoderNames([{ decoder: "string" }, { decoder: "getters" }], ["string", "fd"], "native")).toThrow(
        "decoder 'getters' is no native decoder. The native decoders are: string, fd.",
      );
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

    it("is rejected by the schema for a type declaration", () => {
      expect(inputRetTypeSettingsSchema.safeParse("int").success).toBe(false);
      expect(inputRetTypeSettingsSchema.safeParse(["int", { maxItems: 10 }]).success).toBe(false);
    });
  });
});

export {};
