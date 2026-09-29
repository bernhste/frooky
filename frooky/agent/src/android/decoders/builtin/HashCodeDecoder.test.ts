import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { HashCodeDecoder } from "./HashCodeDecoder";

describe("HashcodeDecoder", () => {
  describe("decode()", () => {
    it("should decode a value as '<runtime class>@<hex hashCode()>'", () => {
      const JavaObject = Java.use("java.lang.Object");
      const value = JavaObject.$new();
      const decoder = new HashCodeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(value);

      const expectedHash = (value.hashCode() >>> 0).toString(16);
      expect(result).toEqual({ type: "java.lang.Object", value: `java.lang.Object@${expectedHash}` });
    });

    it("should use hashCode() instead of toString(), even when toString() is overridden", () => {
      // BigInteger.toString() prints its decimal value
      const BigInteger = Java.use("java.math.BigInteger");
      const value = BigInteger.$new("123456789");
      const decoder = new HashCodeDecoder({ type: "java.math.BigInteger", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(value);

      expect(result.value).not.toBe(value.toString());
      const expectedHash = (value.hashCode() >>> 0).toString(16);
      expect(result).toEqual({ type: "java.math.BigInteger", value: `java.math.BigInteger@${expectedHash}` });
    });

    it("should report the same hash for two distinct objects whose overridden hashCode() is content-based", () => {
      // Long.hashCode() is value-based, and `new Long(String)` always creates a new object
      const JavaLong = Java.use("java.lang.Long");
      const first = JavaLong.$new("123456789012345");
      const second = JavaLong.$new("123456789012345");
      const decoder = new HashCodeDecoder({ type: "java.lang.Long", settings: DEFAULT_DECODER_SETTINGS });

      const firstResult = decoder.decode(first);
      const secondResult = decoder.decode(second);

      expect(firstResult).toEqual(secondResult);
    });

    it("should include the decodable name in the result", () => {
      const JavaObject = Java.use("java.lang.Object");
      const value = JavaObject.$new();
      const decoder = new HashCodeDecoder({ type: "java.lang.Object", name: "myParam", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(value);

      expect(result.name).toBe("myParam");
    });

    it("should decode a null value as null without throwing", () => {
      const decoder = new HashCodeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.lang.Object", value: null });
    });

    it("should decode an object wrapped as an interface without throwing", () => {
      const BigInteger = Java.use("java.math.BigInteger");
      const value = BigInteger.$new("123456789");
      const asInterface = Java.cast(value, Java.use("java.io.Serializable"));
      const decoder = new HashCodeDecoder({ type: "java.io.Serializable", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(asInterface);

      const expectedHash = (value.hashCode() >>> 0).toString(16);
      expect(result).toEqual({ type: "java.io.Serializable", value: `java.math.BigInteger@${expectedHash}` });
    });
  });
});

export {};
