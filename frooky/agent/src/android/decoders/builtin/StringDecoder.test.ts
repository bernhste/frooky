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

    it("should cut the toString() of an object at maxItems characters", () => {
      const value = Java.use("java.math.BigInteger").$new("123456789");
      const decoder = new StringDecoder({ type: "java.math.BigInteger", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 4 } });

      expect(decoder.decode(value)).toEqual({ type: "java.math.BigInteger", value: "1234..." });
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

      const expectedAscii = toAscii(new Uint8Array([0x41, 0x42, 0x43]), DEFAULT_DECODER_SETTINGS.maxItems);
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

      const expectedUtf8 = toUtf8(new Uint8Array(utf8Bytes), DEFAULT_DECODER_SETTINGS.maxItems);
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

      const expectedAscii = toAscii(new Uint8Array(invalidUtf8Bytes), DEFAULT_DECODER_SETTINGS.maxItems);
      expect(result).toEqual({ type: "[B", value: expectedAscii });
    });

    it("should truncate a '[B' byte array longer than maxItems and append an ellipsis", () => {
      const rawBytes = [0x41, 0x42, 0x43, 0x44, 0x45]; // "ABCDE"
      const bytes = Java.array("byte", rawBytes);
      const decoder = new StringDecoder({ type: "[B", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 3 } });

      const result = decoder.decode(bytes as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "[B", value: "ABC..." });
    });

    it("should decode a null '[B' byte array without throwing", () => {
      const decoder = new StringDecoder({ type: "[B", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "[B", value: null });
    });

    it("should decode a null non-array reference without throwing", () => {
      const decoder = new StringDecoder({ type: "java.math.BigInteger", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.math.BigInteger", value: null });
    });

    it("should decode a regular object with no overridden toString() using Object.toString()", () => {
      const JavaObject = Java.use("java.lang.Object");
      const value = JavaObject.$new();
      const decoder = new StringDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(value);

      expect(typeof result.value).toBe("string");
      expect((result.value as string).startsWith("java.lang.Object@")).toBe(true);
    });

    it("should decode an object wrapped as an interface using the runtime object's overridden toString()", () => {
      // BigInteger overrides toString(), but Serializable is an interface declaring no methods
      const BigInteger = Java.use("java.math.BigInteger");
      const value = BigInteger.$new("123456789");
      const asInterface = Java.cast(value, Java.use("java.io.Serializable"));
      const decoder = new StringDecoder({ type: "java.io.Serializable", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(asInterface);

      expect(result).toEqual({ type: "java.io.Serializable", value: "123456789" });
    });

    it("should decode an interface wrapper whose runtime class has no overridden toString() using Java Object.toString()", () => {
      // java.util.Random implements Serializable but does not override toString()
      const Random = Java.use("java.util.Random");
      const random = Random.$new();
      const asInterface = Java.cast(random, Java.use("java.io.Serializable"));
      const decoder = new StringDecoder({ type: "java.io.Serializable", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(asInterface);

      expect(typeof result.value).toBe("string");
      expect(result.value).not.toBe("[object Object]");
      expect((result.value as string).startsWith("java.util.Random@")).toBe(true);
    });
  });

  describe("char[]", () => {
    it("decodes a char[] as text", () => {
      const decoder = new StringDecoder({ type: "[C", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(Java.array("char", ["p", "w", "d"]) as unknown as Java.Wrapper)).toEqual({ type: "[C", value: "pwd" });
    });

    it("limits a char[] to maxItems characters", () => {
      const decoder = new StringDecoder({ type: "[C", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 2 } });

      expect(decoder.decode(Java.array("char", ["p", "w", "d"]) as unknown as Java.Wrapper).value).toBe("pw...");
    });
  });
});

export {};
