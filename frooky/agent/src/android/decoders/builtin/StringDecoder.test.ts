import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { toAscii, toUtf8 } from "../../../shared/utils";
import { StringDecoder } from "./StringDecoder";

describe("StringDecoder", () => {
  describe("decode()", () => {
    it("should decode a value with no useful getters via toString()", () => {
      const BigInteger = Java.use("java.math.BigInteger");
      const value = BigInteger.$new("123456789");
      const decoder = new StringDecoder({ type: "java.math.BigInteger", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(value);

      expect(result).toEqual({ type: "java.math.BigInteger", value: value.toString() });
    });

    it("should include the decodable name in the result", () => {
      const BigInteger = Java.use("java.math.BigInteger");
      const value = BigInteger.$new("42");
      const decoder = new StringDecoder({ type: "java.math.BigInteger", name: "myParam", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(value);

      expect(result).toEqual({ type: "java.math.BigInteger", name: "myParam", value: value.toString() });
    });

    it("should decode a '[B' byte array as ascii instead of calling toString() on it", () => {
      const bytes = Java.array("byte", [0x41, 0x42, 0x43]); // "ABC"
      const decoder = new StringDecoder({ type: "[B", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(bytes as unknown as Java.Wrapper);

      const expectedAscii = toAscii(new Uint8Array([0x41, 0x42, 0x43]), DEFAULT_DECODER_SETTINGS.decodeLimit);
      expect(result).toEqual({ type: "[B", value: expectedAscii });
    });

    it("should decode a '[B' byte array containing valid UTF-8 multi-byte characters as UTF-8", () => {
      // "héllo" - "é" is encoded as the 2-byte UTF-8 sequence 0xc3 0xa9
      const utf8Bytes = [0x68, 0xc3, 0xa9, 0x6c, 0x6c, 0x6f];
      const bytes = Java.array(
        "byte",
        utf8Bytes.map((b) => (b > 0x7f ? b - 0x100 : b)),
      );
      const decoder = new StringDecoder({ type: "[B", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(bytes as unknown as Java.Wrapper);

      const expectedUtf8 = toUtf8(new Uint8Array(utf8Bytes), DEFAULT_DECODER_SETTINGS.decodeLimit);
      expect(result).toEqual({ type: "[B", value: expectedUtf8 });
      expect(result.value).toBe("héllo");
    });

    it("should fall back to ascii for a '[B' byte array with non-ascii bytes that are not valid UTF-8", () => {
      // a lone continuation byte (0x80) is not a well-formed UTF-8 sequence on its own
      const invalidUtf8Bytes = [0x41, 0x80, 0x42];
      const bytes = Java.array(
        "byte",
        invalidUtf8Bytes.map((b) => (b > 0x7f ? b - 0x100 : b)),
      );
      const decoder = new StringDecoder({ type: "[B", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(bytes as unknown as Java.Wrapper);

      const expectedAscii = toAscii(new Uint8Array(invalidUtf8Bytes), DEFAULT_DECODER_SETTINGS.decodeLimit);
      expect(result).toEqual({ type: "[B", value: expectedAscii });
    });

    it("should truncate a '[B' byte array longer than decodeLimit and append an ellipsis", () => {
      const rawBytes = [0x41, 0x42, 0x43, 0x44, 0x45]; // "ABCDE"
      const bytes = Java.array("byte", rawBytes);
      const decoder = new StringDecoder({ type: "[B", settings: { ...DEFAULT_DECODER_SETTINGS, decodeLimit: 3 } });

      const result = decoder.decode(bytes as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "[B", value: "ABC..." });
    });

    it("should decode a null '[B' byte array without throwing (regression)", () => {
      // a "[B" is a reference type too and can legitimately be null (e.g. an uninitialized
      // output buffer) - readBytesLimited(null, ...), which the "[B" branch relies on, throws
      // rather than producing an empty/null result, so null must be checked before that branch is reached
      const decoder = new StringDecoder({ type: "[B", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "[B", value: null });
    });

    it("should decode a null non-array reference without throwing", () => {
      const decoder = new StringDecoder({ type: "java.math.BigInteger", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.math.BigInteger", value: null });
    });
  });
});

export {};
