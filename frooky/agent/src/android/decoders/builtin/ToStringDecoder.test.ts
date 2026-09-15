import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { toHexAndAscii } from "../../../shared/utils";
import { ToStringDecoder } from "./ToStringDecoder";

describe("ToStringDecoder", () => {
  describe("decode()", () => {
    it("should decode a value with no useful getters via toString()", () => {
      // java.math.BigInteger has no "get"-prefixed methods at all, so reflecting its getters via
      // GetterDecoder would silently lose the value (an empty properties array) - this is
      // exactly the case ToStringDecoder exists for
      const BigInteger = Java.use("java.math.BigInteger");
      const value = BigInteger.$new("123456789");
      const decoder = new ToStringDecoder({ type: "java.math.BigInteger", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(value);

      expect(result).toEqual({ type: "java.math.BigInteger", value: value.toString() });
    });

    it("should include the decodable name in the result", () => {
      const BigInteger = Java.use("java.math.BigInteger");
      const value = BigInteger.$new("42");
      const decoder = new ToStringDecoder({ type: "java.math.BigInteger", name: "myParam", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(value);

      expect(result).toEqual({ type: "java.math.BigInteger", name: "myParam", value: value.toString() });
    });

    it("should decode a '[B' byte array as [ascii, hex] instead of calling toString() on it", () => {
      const bytes = Java.array("byte", [0x41, 0x42, 0x43]); // "ABC"
      const decoder = new ToStringDecoder({ type: "[B", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(bytes as unknown as Java.Wrapper);

      const [expectedHex, expectedAscii] = toHexAndAscii(new Uint8Array([0x41, 0x42, 0x43]), DEFAULT_DECODER_SETTINGS.decodeLimit);
      expect(result).toEqual({ type: "[B", value: [expectedAscii, expectedHex] });
    });

    it("should decode a null '[B' byte array without throwing (regression)", () => {
      // a "[B" is a reference type too and can legitimately be null (e.g. an uninitialized
      // output buffer) - Array.from(null), which the "[B" branch relies on, throws rather than
      // producing an empty/null result, so null must be checked before that branch is reached
      const decoder = new ToStringDecoder({ type: "[B", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "[B", value: null });
    });

    it("should decode a null non-array reference without throwing", () => {
      const decoder = new ToStringDecoder({ type: "java.math.BigInteger", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.math.BigInteger", value: null });
    });
  });
});

export {};
