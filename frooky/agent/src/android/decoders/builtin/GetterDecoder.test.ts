import Java from "frida-java-bridge";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { GetterDecoder } from "./GetterDecoder";

describe("GetterDecoder", () => {
  describe("decode()", () => {
    const JavaObject = Java.use("java.lang.Object");
    const decoder = new GetterDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });

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
      // getDeclaringClass() - reflecting those via GetterDecoder would recurse without bound and
      // crash the Frida script ("Fatal error: Script is destroyed") by exhausting the native call
      // stack. ReferenceTypeDecoder never routes back into GetterDecoder for an unregistered type
      // like java.lang.Class - it falls back to StringDecoder instead - so this must complete and
      // return a plain string.
      const javaObject = JavaObject.$new();
      const result = decoder.decode(javaObject);

      const properties = result.value as DecodedValue[];
      const classProperty = properties.find((p) => p.name === "class");
      // classProperty.value is itself a DecodedValue (ReferenceTypeDecoder always wraps the
      // inner decoder's result), whose own value is the toString() from the StringDecoder fallback
      const nestedValue = classProperty?.value as DecodedValue;
      expect(nestedValue.type).toBe("java.lang.Class");
      expect(typeof nestedValue.value).toBe("string");
    });

    it("should include the decodable name in the result", () => {
      const namedDecoder = new GetterDecoder({ type: "java.lang.Object", name: "myParam", settings: DEFAULT_DECODER_SETTINGS });
      const javaObject = JavaObject.$new();
      const result = namedDecoder.decode(javaObject);

      expect(result.type).toBe("java.lang.Object");
      expect(result.name).toBe("myParam");
      expect(Array.isArray(result.value)).toBe(true);
    });
  });
});
