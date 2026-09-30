import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { PrimitiveDecoder } from "./PrimitiveDecoder";

describe("PrimitiveDecoder", () => {
  describe("decode()", () => {
    it("should decode a java int primitive correctly", () => {
      const decoder = new PrimitiveDecoder({ type: "int", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Integer").$new(42).intValue();
      const result = decoder.decode(primitive);
      expect(result).toEqual({ type: "int", value: 42 });
    });

    it("should decode a java long primitive correctly", () => {
      const decoder = new PrimitiveDecoder({ type: "long", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Long").$new("9223372036854775807").longValue();
      const result = decoder.decode(primitive);
      expect(result).toEqual({ type: "long", value: "9223372036854775807" });
    });

    it("should decode a java double primitive correctly", () => {
      const decoder = new PrimitiveDecoder({ type: "double", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Double").$new(2.718281828459045235).doubleValue();
      const result = decoder.decode(primitive);
      expect(result).toEqual({ type: "double", value: 2.718281828459045235 });
    });

    it("should decode a java float primitive correctly", () => {
      const decoder = new PrimitiveDecoder({ type: "float", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Float").$new(3.14159265358979323846264).floatValue();
      const result = decoder.decode(primitive);

      // float has less precision than a JS number, so we allow a small margin of error
      expect(result.type).toBe("float");
      const diff = Math.abs((result.value as number) - 3.14159265358979323846264);
      expect(diff).toBeLessThan(0.00001);
    });

    it("should decode a java boolean primitive correctly", () => {
      const decoder = new PrimitiveDecoder({ type: "boolean", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Boolean").$new(true).booleanValue();
      const result = decoder.decode(primitive);
      expect(result).toEqual({ type: "boolean", value: true });
    });

    it("should decode a java byte primitive correctly", () => {
      const decoder = new PrimitiveDecoder({ type: "byte", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Byte").$new(127).byteValue();
      const result = decoder.decode(primitive);
      expect(result).toEqual({ type: "byte", value: 127 });
    });

    it("should decode a java short primitive correctly", () => {
      const decoder = new PrimitiveDecoder({ type: "short", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Short").$new(32767).shortValue();
      const result = decoder.decode(primitive);
      expect(result).toEqual({ type: "short", value: 32767 });
    });

    it("should decode a java char primitive correctly", () => {
      const decoder = new PrimitiveDecoder({ type: "char", settings: DEFAULT_DECODER_SETTINGS });
      const JavaCharacter = Java.use("java.lang.Character") as any;
      const charValue = (JavaCharacter.valueOf("A") as any).charValue();
      const result = decoder.decode(charValue);

      expect(result).toEqual({ type: "char", value: "A" });
    });

    it("should decode a java string primitive correctly", () => {
      const decoder = new PrimitiveDecoder({ type: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = "hello world" as unknown as Java.Wrapper;
      const result = decoder.decode(primitive);

      expect(result).toEqual({ type: "java.lang.String", value: "hello world" });
    });

    it("should cut a java string longer than maxItems characters and append an ellipsis", () => {
      const decoder = new PrimitiveDecoder({ type: "java.lang.String", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 5 } });

      expect(decoder.decode("hello world" as unknown as Java.Wrapper)).toEqual({ type: "java.lang.String", value: "hello..." });
    });

    it("should keep a java string of at most maxItems characters complete", () => {
      const decoder = new PrimitiveDecoder({ type: "java.lang.String", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 5 } });

      expect(decoder.decode("hello" as unknown as Java.Wrapper)).toEqual({ type: "java.lang.String", value: "hello" });
    });

    it("should not cut a long by maxItems", () => {
      const decoder = new PrimitiveDecoder({ type: "long", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 3 } });

      expect(decoder.decode(Java.use("java.lang.Long").$new("9223372036854775807").longValue())).toEqual({
        type: "long",
        value: "9223372036854775807",
      });
    });

    it("should decode a null java string without throwing", () => {
      const decoder = new PrimitiveDecoder({ type: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.lang.String", value: null });
    });

    it("should include the decodable name in the result", () => {
      const decoder = new PrimitiveDecoder({ type: "int", name: "myParam", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Integer").$new(42).intValue();
      const result = decoder.decode(primitive);

      expect(result).toEqual({ type: "int", name: "myParam", value: 42 });
    });
  });
});
