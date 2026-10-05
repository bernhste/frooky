import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { HashCodeDecoder } from "./HashCodeDecoder";

const identityHash = (value: Java.Wrapper): string => (Java.use("java.lang.System").identityHashCode(value) >>> 0).toString(16);

describe("HashcodeDecoder", () => {
  describe("decode()", () => {
    it("should decode a value as '<runtime class>@<hex identityHashCode()>'", () => {
      const JavaObject = Java.use("java.lang.Object");
      const value = JavaObject.$new();
      const decoder = new HashCodeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(value);

      const expectedHash = identityHash(value);
      expect(result).toEqual({ type: "java.lang.Object", value: `java.lang.Object@${expectedHash}` });
    });

    it("should call neither an overridden toString() nor an overridden hashCode()", () => {
      // BigInteger.toString() prints its decimal value, BigInteger.hashCode() is computed from it
      const BigInteger = Java.use("java.math.BigInteger");
      const value = BigInteger.$new("123456789");
      const decoder = new HashCodeDecoder({ type: "java.math.BigInteger", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(value);

      expect(result).toEqual({ type: "java.math.BigInteger", value: `java.math.BigInteger@${identityHash(value)}` });
    });

    it("should tell apart two distinct objects whose overridden hashCode() is content-based", () => {
      // Long.hashCode() is value-based, and `new Long(String)` always creates a new object
      const JavaLong = Java.use("java.lang.Long");
      const first = JavaLong.$new("123456789012345");
      const second = JavaLong.$new("123456789012345");
      const decoder = new HashCodeDecoder({ type: "java.lang.Long", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(first)).not.toEqual(decoder.decode(second));
    });

    it("should decode the same object to the same value", () => {
      const value = Java.use("java.util.ArrayList").$new();
      const decoder = new HashCodeDecoder({ type: "java.util.ArrayList", settings: DEFAULT_DECODER_SETTINGS });

      const before = decoder.decode(value);
      value.add("changes the content-based hashCode() of the list");

      expect(decoder.decode(value)).toEqual(before);
    });

    it("should throw for a primitive, so the default decoder takes over", () => {
      const decoder = new HashCodeDecoder({ type: "int", settings: DEFAULT_DECODER_SETTINGS });

      expect(() => decoder.decode(42 as unknown as Java.Wrapper)).toThrow();
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

      const expectedHash = identityHash(value);
      expect(result).toEqual({ type: "java.io.Serializable", value: `java.math.BigInteger@${expectedHash}` });
    });
  });
});

export {};
