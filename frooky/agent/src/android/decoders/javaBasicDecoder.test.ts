import Java from "frida-java-bridge";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { JavaFallbackDecoder, JavaPrimitiveDecoder, JavaReflectionMetadataDecoder } from "./javaBasicDecoder";

describe("JavaPrimitiveDecoder", () => {
  describe("decode()", () => {
    it("should decode a java int primitive correctly", () => {
      const decoder = new JavaPrimitiveDecoder({ type: "int", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Integer").$new(42).intValue();
      const result = decoder.decode(primitive);
      expect(result).toEqual({ type: "int", value: 42 });
    });

    it("should decode a java long primitive correctly", () => {
      const decoder = new JavaPrimitiveDecoder({ type: "long", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Long").$new("9223372036854775807").longValue();
      const result = decoder.decode(primitive);
      expect(result).toEqual({ type: "long", value: "9223372036854775807" });
    });

    it("should decode a java double primitive correctly", () => {
      const decoder = new JavaPrimitiveDecoder({ type: "double", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Double").$new(2.718281828459045235).doubleValue();
      const result = decoder.decode(primitive);
      expect(result).toEqual({ type: "double", value: 2.718281828459045235 });
    });

    it("should decode a java float primitive correctly", () => {
      const decoder = new JavaPrimitiveDecoder({ type: "float", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Float").$new(3.14159265358979323846264).floatValue();
      const result = decoder.decode(primitive);

      // float has less precision than a JS number, so we allow a small margin of error
      expect(result.type).toBe("float");
      const diff = Math.abs((result.value as number) - 3.14159265358979323846264);
      expect(diff).toBeLessThan(0.00001);
    });

    it("should decode a java boolean primitive correctly", () => {
      const decoder = new JavaPrimitiveDecoder({ type: "boolean", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Boolean").$new(true).booleanValue();
      const result = decoder.decode(primitive);
      expect(result).toEqual({ type: "boolean", value: true });
    });

    it("should decode a java byte primitive correctly", () => {
      const decoder = new JavaPrimitiveDecoder({ type: "byte", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Byte").$new(127).byteValue();
      const result = decoder.decode(primitive);
      expect(result).toEqual({ type: "byte", value: 127 });
    });

    it("should decode a java short primitive correctly", () => {
      const decoder = new JavaPrimitiveDecoder({ type: "short", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Short").$new(32767).shortValue();
      const result = decoder.decode(primitive);
      expect(result).toEqual({ type: "short", value: 32767 });
    });

    it("should decode a java char primitive correctly", () => {
      const decoder = new JavaPrimitiveDecoder({ type: "char", settings: DEFAULT_DECODER_SETTINGS });
      const JavaCharacter = Java.use("java.lang.Character") as any;
      const charValue = (JavaCharacter.valueOf("A") as any).charValue();
      const result = decoder.decode(charValue);

      expect(result).toEqual({ type: "char", value: "A" });
    });

    it("should decode a java string primitive correctly", () => {
      const decoder = new JavaPrimitiveDecoder({ type: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = "hello world" as unknown as Java.Wrapper;
      const result = decoder.decode(primitive);

      expect(result).toEqual({ type: "java.lang.String", value: "hello world" });
    });

    it("should decode a null java string without throwing", () => {
      const decoder = new JavaPrimitiveDecoder({ type: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.lang.String", value: null });
    });

    it("should include the decodable name in the result", () => {
      const decoder = new JavaPrimitiveDecoder({ type: "int", name: "myParam", settings: DEFAULT_DECODER_SETTINGS });
      const primitive = Java.use("java.lang.Integer").$new(42).intValue();
      const result = decoder.decode(primitive);

      expect(result).toEqual({ type: "int", name: "myParam", value: 42 });
    });
  });
});

describe("JavaFallbackDecoder", () => {
  describe("decode()", () => {
    const JavaObject = Java.use("java.lang.Object");
    const decoder = new JavaFallbackDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });

    it("should decode every public getter, stripping the get/is prefix from the property name", () => {
      const javaObject = JavaObject.$new();
      const result = decoder.decode(javaObject);

      expect(result.type).toBe("java.lang.Object");
      const properties = result.value as DecodedValue[];
      // Object's only declared "get*" method is getClass(), which decodeGetterValues exposes
      // with the prefix stripped to "class".
      const classProperty = properties.find((p) => p.name === "class");
      expect(classProperty?.type).toBe("java.lang.Class");
    });

    it("should decode getClass()'s result via toString(), not by recursing into its own getters (regression)", () => {
      // Class's own declared getters (getDeclaredMethods(), getFields(), ...) return arrays of
      // Method/Field/Constructor objects that point straight back to their declaring Class via
      // getDeclaringClass() - reflecting those via JavaFallbackDecoder used to recurse without
      // bound and crash the Frida script ("Fatal error: Script is destroyed") by exhausting the
      // native call stack. JavaReferenceTypeDecoder now routes java.lang.Class to
      // JavaReflectionMetadataDecoder instead, so this must complete and return a plain string.
      const javaObject = JavaObject.$new();
      const result = decoder.decode(javaObject);

      const properties = result.value as DecodedValue[];
      const classProperty = properties.find((p) => p.name === "class");
      // classProperty.value is itself a DecodedValue (JavaReferenceTypeDecoder always wraps the
      // inner decoder's result), whose own value is the toString() from JavaReflectionMetadataDecoder
      const nestedValue = classProperty?.value as DecodedValue;
      expect(nestedValue.type).toBe("java.lang.Class");
      expect(typeof nestedValue.value).toBe("string");
    });

    it("should include the decodable name in the result", () => {
      const namedDecoder = new JavaFallbackDecoder({ type: "java.lang.Object", name: "myParam", settings: DEFAULT_DECODER_SETTINGS });
      const javaObject = JavaObject.$new();
      const result = namedDecoder.decode(javaObject);

      expect(result.type).toBe("java.lang.Object");
      expect(result.name).toBe("myParam");
      expect(Array.isArray(result.value)).toBe(true);
    });
  });
});

describe("JavaReflectionMetadataDecoder", () => {
  describe("decode()", () => {
    it("should decode a java.lang.Class value via toString()", () => {
      const JavaObject = Java.use("java.lang.Object");
      const classValue = JavaObject.class;
      const decoder = new JavaReflectionMetadataDecoder({ type: "java.lang.Class", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(classValue);

      expect(result).toEqual({ type: "java.lang.Class", value: classValue.toString() });
    });
  });
});
