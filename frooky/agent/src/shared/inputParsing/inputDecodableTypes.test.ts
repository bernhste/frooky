import { DEFAULT_DECODER_SETTINGS } from "../defaultValues";
import {
  normalizeInputParams,
  normalizeInputReturn,
  normalizeInputReturnSettings,
  validateDecoderArgRoles,
  validateDecoderOptions,
  validateDecoderNames,
  validateValueTypes,
} from "./inputDecodableTypes";
import { InputParamSettings } from "./inputSettings";
import { validateInput } from "../configValidator";
import { decoderArgsOf } from "../decoders/decoderArgs";
import { inputParamSchema, inputReturnSchema } from "./zodSchemas/inputDecodableTypes.zod";
import { inputReturnSettingsSchema } from "./zodSchemas/inputSettings.zod";

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

    it("should normalize an object with its settings to a Param", () => {
      expect(normalizeInputParams([{ type: "testParam", name: "paramName", ...inlineSettings }])[0]).toEqual({
        type: "testParam",
        name: "paramName",
        direction: "out",
        settings: expectedSettings,
      });
    });

    it("should complete an object with only type and name", () => {
      const input = { type: "java.lang.String", name: "action" };
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
      const params = normalizeInputParams([["int", { maxItems: 5 }], ["int", "n", { maxItems: 5 }], { type: "int", maxItems: 5 }], outerSettings);
      for (const param of params) expect(param.settings).toEqual({ ...outerSettings, maxItems: 5 });
    });
  });

  describe("normalizeInputParams(), length and offset", () => {
    it("accepts another param, a number or the return value", () => {
      const params = normalizeInputParams([
        ["[B", "key", { offset: "offset", length: 16 }],
        ["int", "offset"],
        ["void *", "buf", { direction: "out", length: "$ret" }],
      ]);
      expect(decoderArgsOf(params[0].settings)).toEqual({ offset: "offset", length: 16 });
      expect(decoderArgsOf(params[2].settings)).toEqual({ length: "$ret" });
    });

    it("throws for an unknown setting", () => {
      expect(() =>
        normalizeInputParams([
          ["const void *", "buf", { size: "count" } as never],
          ["size_t", "count"],
        ]),
      ).toThrow("decoder settings contains unknown properties: size");
    });

    it("throws when no param has the name", () => {
      expect(() => normalizeInputParams(["int", ["const void *", "buf", { length: "count" }], "size_t"])).toThrow(
        "'length: count' of 'buf' names no parameter. Use the name of another parameter, '$ret' or a number.",
      );
    });

    it("throws for a number that is no count", () => {
      expect(() => normalizeInputParams([["const void *", "buf", { length: -1 }]])).toThrow("decoder settings is invalid");
      expect(() => normalizeInputParams([["const void *", "buf", { offset: 1.5 }]])).toThrow("decoder settings is invalid");
      expect(normalizeInputParams([["const void *", "buf", { length: 0, offset: 16 }]])[0].settings.length).toBe(0);
    });

    it("throws when a role names the param itself", () => {
      expect(() => normalizeInputParams([["const void *", "buf", { length: "buf" }], "size_t"])).toThrow("is the parameter itself");
    });

    it("throws when a role names more than one param", () => {
      expect(() =>
        normalizeInputParams([
          ["const void *", { length: "n" }],
          ["size_t", "n"],
          ["int", "n"],
        ]),
      ).toThrow("more than one parameter is named");
    });

    it("throws when the return value is passed to a param decoded on entry", () => {
      expect(() => normalizeInputParams(["int", ["void *", "buf", { length: "$ret" }]])).toThrow("Set 'direction: out' on 'buf'");
      expect(() => normalizeInputParams(["int", ["void *", "buf", { direction: "inout", length: "$ret" }]])).toThrow("Set 'direction: out'");
    });
  });

  describe("validateDecoderArgRoles()", () => {
    const params = normalizeInputParams([["[B", "key", { offset: 1, length: 2 }], "int"]);

    it("accepts what the decoder accepts", () => {
      expect(() => validateDecoderArgRoles(params, () => ["length", "offset"])).not.toThrow();
    });

    it("throws for what the decoder doesn't accept, naming what it accepts", () => {
      expect(() => validateDecoderArgRoles(params, () => ["length"])).toThrow(
        "'key': the decoder of '[B' doesn't accept 'offset'. It accepts: length.",
      );
      expect(() => validateDecoderArgRoles(params, () => [])).toThrow(
        "doesn't accept 'length' and 'offset'. It accepts neither 'length' nor 'offset'.",
      );
    });
  });

  describe("validateDecoderOptions()", () => {
    const withConstants = { ...DEFAULT_DECODER_SETTINGS, decoderOptions: { constants: { A: 1 } } };
    const acceptsConstants = () => ["constants"];

    it("accepts options the decoder accepts, and values without decoderOptions", () => {
      expect(() =>
        validateDecoderOptions(
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
      expect(() => validateDecoderOptions([["data", { ...withConstants, decoder: "base64" }]], () => [])).toThrow(
        "decoderOptions of 'data': decoder 'base64' doesn't accept 'constants'. It accepts no decoderOptions.",
      );
    });

    it("throws for decoderOptions without a decoder, naming the decoder of the type", () => {
      expect(() => validateDecoderOptions([["return value", withConstants]], () => [])).toThrow(
        "decoderOptions of 'return value': the decoder of its type doesn't accept 'constants'. It accepts no decoderOptions.",
      );
    });

    it("lists the accepted options", () => {
      const settings = { ...DEFAULT_DECODER_SETTINGS, decoder: "constants" as const, decoderOptions: { constants: { A: 1 }, other: 1 } as never };
      expect(() => validateDecoderOptions([["mode", settings]], acceptsConstants)).toThrow(
        "decoderOptions of 'mode': decoder 'constants' doesn't accept 'other'. It accepts: constants.",
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

  describe("normalizeInputReturn()", () => {
    it("should normalize a valid string to a RetType", () => {
      expect(normalizeInputReturn("int")).toEqual({ type: "int", settings: DEFAULT_DECODER_SETTINGS });
    });

    it("should normalize a valid [string, Partial<DecoderSettings>] to a RetType", () => {
      expect(normalizeInputReturn(["android.database.sqlite.SQLiteCursor", { maxItems: 10 }])).toEqual({
        type: "android.database.sqlite.SQLiteCursor",
        settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 10 },
      });
    });

    it("should normalize an object with its settings to a RetType", () => {
      expect(normalizeInputReturn({ type: "int", name: "result", maxItems: 30 })).toEqual({
        type: "int",
        name: "result",
        settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 30 },
      });
    });

    it("is rejected by the schema with the settings of a parameter", () => {
      for (const setting of [{ argFilter: ["== -1"] }, { length: 4 }, { direction: "out" }]) {
        expect(() => validateInput(inputReturnSchema, ["int", setting], "returns")).toThrow("returns contains unknown properties");
      }
    });
  });

  describe("normalizeInputReturnSettings()", () => {
    it("normalizes a bare decoder settings object", () => {
      expect(normalizeInputReturnSettings({ maxItems: 10 })).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxItems: 10 });
    });

    it("merges a bare decoder settings object on top of the given base settings", () => {
      expect(normalizeInputReturnSettings({ maxItems: 10 }, { ...DEFAULT_DECODER_SETTINGS, maxDepth: 30 })).toEqual({
        ...DEFAULT_DECODER_SETTINGS,
        maxDepth: 30,
        maxItems: 10,
      });
    });

    it("is rejected by the schema for a type declaration", () => {
      expect(inputReturnSettingsSchema.safeParse("int").success).toBe(false);
      expect(inputReturnSettingsSchema.safeParse(["int", { maxItems: 10 }]).success).toBe(false);
    });
  });

  describe("argFilter patterns", () => {
    const withFilter = (argFilter: string[]) => normalizeInputParams([["int", "value", { argFilter }]]);

    it("accepts numeric comparisons and regular expressions", () => {
      for (const pattern of ["> 100", ">=0", "< -1.5", "<= 1e3", "== 42", "!= 0", "^button_", "<html>", "a=b", "[<>]=?"]) {
        expect(() => withFilter([pattern])).not.toThrow();
      }
    });

    it("throws for a pattern that starts like a comparison but isn't one", () => {
      for (const pattern of ["= 5", " > 5", "> 5 < 10", "== 0x10", ">5 ", "<= 1,5"]) {
        expect(() => withFilter([pattern])).toThrow(`argFilter of 'value': '${pattern}' is no numeric comparison.`);
      }
    });

    it("throws for a pattern that is no regular expression, naming the parameter", () => {
      expect(() => withFilter(["^ok$", "(?i)welcome"])).toThrow("argFilter of 'value': '(?i)welcome' is no regular expression:");
      expect(() => normalizeInputParams([["int", { argFilter: ["("] }]])).toThrow("argFilter of 'int': '(' is no regular expression:");
    });

    it("throws for an empty pattern", () => {
      expect(() => withFilter([""])).toThrow("decoder settings is invalid");
    });
  });

  describe("validateValueTypes()", () => {
    const types = (...names: string[]) => names.map((type) => ({ type }));

    it("accepts Java type descriptors in Java hooks", () => {
      expect(() =>
        validateValueTypes(
          types("int", "boolean", "java.lang.String", "a.b$c", "Foo", "[B", "[[I", "[Ljava.lang.String;", "[[Lcom.example.Outer$Inner;"),
          "Java",
        ),
      ).not.toThrow();
    });

    it("throws for a Java type written the Java or JNI way, suggesting its descriptor", () => {
      const message = (type: string, name?: string) => {
        try {
          validateValueTypes([{ type, name }], "Java");
        } catch (e) {
          return (e as Error).message;
        }
        return undefined;
      };

      expect(message("byte[]", "data")).toContain("'byte[]' as the type of 'data' is no Java type descriptor. Did you mean '[B'?");
      expect(message("java.lang.String[]")).toContain(
        "'java.lang.String[]' as a type is no Java type descriptor. Did you mean '[Ljava.lang.String;'?",
      );
      expect(message("int[][]")).toContain("Did you mean '[[I'?");
      expect(message("[Ljava/lang/String;")).toContain("Did you mean '[Ljava.lang.String;'?");
      expect(message("Ljava/lang/String;")).toContain("Did you mean 'java.lang.String'?");
      expect(message("java/lang/String")).toContain("Did you mean 'java.lang.String'?");
      expect(message("const char *")).toContain("'const char *' as a type is no Java type descriptor. Write a primitive or a class");
      expect(message("[X")).toContain("is no Java type descriptor.");
    });

    it("accepts C types in native hooks", () => {
      expect(() =>
        validateValueTypes(
          types(
            "int",
            "unsigned long long",
            "const char *",
            "char*",
            "char **",
            "char *const []",
            "int[4]",
            "struct foo *",
            "std::string &",
            "size_t",
            "uint8_t",
          ),
          "native",
        ),
      ).not.toThrow();
    });

    it("throws for a type that is no C type in a native hook", () => {
      for (const type of ["java.lang.String", "[B", "[Ljava.lang.String;", "int;", "$ret"]) {
        expect(() => validateValueTypes([{ type, name: "arg" }], "native")).toThrow(`'${type}' as the type of 'arg' is no C type.`);
      }
    });
  });

  describe("schema of types and names", () => {
    const param = (value: unknown) => inputParamSchema.safeParse(value).success;

    it("accepts the types of both platforms and identifiers as names", () => {
      for (const type of ["int", "java.lang.String", "[B", "[Ljava.lang.String;", "const char *", "char *const []", "java.lang.String[]"]) {
        expect(param(type)).toBe(true);
        expect(param([type, "value"])).toBe(true);
        expect(param({ type, name: "out_len" })).toBe(true);
      }
      expect(param(["int", "$receiver"])).toBe(true);
    });

    it("rejects a type that is empty, has whitespace around it or isn't made of type characters", () => {
      for (const type of ["", " ", " int", "int ", "...", "int (*)(void)", "1int", "char\t*"]) {
        expect(param(type)).toBe(false);
        expect(param([type, "value"])).toBe(false);
        expect(param({ type })).toBe(false);
      }
    });

    it("rejects a name that is empty, no identifier or `$ret`", () => {
      for (const name of ["", "$ret", "out len", "1st", "a-b", "a.b"]) {
        expect(param(["int", name])).toBe(false);
        expect(param(["int", name, {}])).toBe(false);
        expect(param({ type: "int", name })).toBe(false);
        expect(inputReturnSchema.safeParse({ type: "int", name }).success).toBe(false);
      }
    });

    it("accepts only the name of a parameter, `$ret` or a whole number that isn't negative as length and offset", () => {
      const withLength = (length: unknown) => param(["void *", "buf", { length }]);

      for (const length of ["len", "$ret", "out_len", 0, 16]) expect(withLength(length)).toBe(true);
      for (const length of ["2", "", "a b", -1, 1.5, true, null]) expect(withLength(length)).toBe(false);
    });
  });
});
