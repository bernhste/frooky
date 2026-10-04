import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { Base64Decoder } from "./Base64Decoder";

describe("Base64Decoder", () => {
  describe("decode()", () => {
    it("should decode a java.lang.String base64 string", () => {
      const decoder = new Base64Decoder({ type: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode("SGVsbG8gV29ybGQ=" as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.lang.String", value: "Hello World" });
    });

    it("should decode a Java String object", () => {
      const value = Java.use("java.lang.String").$new("SGVsbG8gV29ybGQ=");
      const decoder = new Base64Decoder({ type: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(value);

      expect(result).toEqual({ type: "java.lang.String", value: "Hello World" });
    });

    it("should include the decodable name in the result", () => {
      const decoder = new Base64Decoder({ type: "java.lang.String", name: "myParam", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode("SGVsbG8=" as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.lang.String", name: "myParam", value: "Hello" });
    });

    it("should decode a '[B' byte array containing base64 data", () => {
      const base64Bytes = Array.from("SGVsbG8=", (c) => c.charCodeAt(0));
      const bytes = Java.array("byte", base64Bytes);
      const decoder = new Base64Decoder({ type: "[B", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(bytes as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "[B", value: "Hello" });
    });

    it("should decode a '[C' char array containing base64 data", () => {
      const chars = Java.array("char", Array.from("SGVsbG8="));
      const decoder = new Base64Decoder({ type: "[C", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(chars as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "[C", value: "Hello" });
    });

    it("should decode a Java object with toString()", () => {
      const StringBuilder = Java.use("java.lang.StringBuilder");
      const sb = StringBuilder.$new("SGVsbG8gV29ybGQ=");
      const decoder = new Base64Decoder({ type: "java.lang.StringBuilder", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(sb);

      expect(result).toEqual({ type: "java.lang.StringBuilder", value: "Hello World" });
    });

    it("should decode base64 containing UTF-8 multi-byte characters", () => {
      // base64 of "grüezi 🙂"
      const base64 = "Z3LDvGV6aSDwn5mC";
      const decoder = new Base64Decoder({ type: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(base64 as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.lang.String", value: "grüezi 🙂" });
    });

    it("should truncate decoded output longer than maxItems and append an ellipsis", () => {
      const decoder = new Base64Decoder({ type: "java.lang.String", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 4 } });

      const result = decoder.decode("SGVsbG8gV29ybGQ=" as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.lang.String", value: "Hell..." });
    });

    it("should decode a null value as null", () => {
      const decoder = new Base64Decoder({ type: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.lang.String", value: null });
    });

    it("should throw for invalid base64 input", () => {
      const decoder = new Base64Decoder({ type: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS });

      expect(() => decoder.decode("not valid base64!" as unknown as Java.Wrapper)).toThrow();
    });

    describe("with the roles offset and length", () => {
      const decode = (type: string, array: unknown, args: Record<string, unknown>) =>
        new Base64Decoder({ type, settings: DEFAULT_DECODER_SETTINGS }).decode(array as Java.Wrapper, args).value;

      it("decodes only the slice of a byte[]", () => {
        const bytes = Java.array(
          "byte",
          Array.from("--SGVsbG8=--", (c) => c.charCodeAt(0)),
        );
        expect(decode("[B", bytes, { offset: 2, length: 8 })).toBe("Hello");
      });

      it("decodes only the slice of a char[]", () => {
        const chars = Java.array("char", Array.from("xxSGVsbG8=xx"));
        expect(decode("[C", chars, { offset: 2, length: 8 })).toBe("Hello");
      });

      it("decodes a negative length as null", () => {
        expect(decode("[B", Java.array("byte", [0x61]), { length: -1 })).toBeNull();
        expect(decode("[C", Java.array("char", ["a"]), { length: -1 })).toBeNull();
      });
    });
  });
});

export {};
