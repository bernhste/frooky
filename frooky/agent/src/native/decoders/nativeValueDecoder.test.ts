import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { FridaFundamentalType } from "./nativeFridaType";
import { NativeValueDecoder } from "./nativeValueDecoder";

const makeDecoder = (fridaType: FridaFundamentalType): NativeValueDecoder =>
  new NativeValueDecoder({ type: fridaType, settings: DEFAULT_DECODER_SETTINGS }, fridaType);

describe("NativeValueDecoder", () => {
  describe("decode()", () => {
    it("should decode void as null", () => {
      const decoder = makeDecoder("void");
      expect(decoder.decode(ptr(0))).toEqual({ type: "void", value: null });
    });

    it("should decode bool true", () => {
      const decoder = makeDecoder("bool");
      expect(decoder.decode(ptr(1))).toEqual({ type: "bool", value: true });
    });

    it("should decode bool false", () => {
      const decoder = makeDecoder("bool");
      expect(decoder.decode(ptr(0))).toEqual({ type: "bool", value: false });
    });

    it("should decode char positive", () => {
      const decoder = makeDecoder("char");
      expect(decoder.decode(ptr(65))).toEqual({ type: "char", value: 65 });
    });

    it("should decode char negative (sign extension)", () => {
      const decoder = makeDecoder("char");
      expect(decoder.decode(ptr(0xff))).toEqual({ type: "char", value: -1 });
    });

    it("should decode int8 positive", () => {
      const decoder = makeDecoder("int8");
      expect(decoder.decode(ptr(127))).toEqual({ type: "int8", value: 127 });
    });

    it("should decode int8 negative", () => {
      const decoder = makeDecoder("int8");
      expect(decoder.decode(ptr(0x80))).toEqual({ type: "int8", value: -128 });
    });

    it("should decode uchar", () => {
      const decoder = makeDecoder("uchar");
      expect(decoder.decode(ptr(0xff))).toEqual({ type: "uchar", value: 255 });
    });

    it("should decode uint8", () => {
      const decoder = makeDecoder("uint8");
      expect(decoder.decode(ptr(0xff))).toEqual({ type: "uint8", value: 255 });
    });

    it("should decode int16 positive", () => {
      const decoder = makeDecoder("int16");
      expect(decoder.decode(ptr(32767))).toEqual({ type: "int16", value: 32767 });
    });

    it("should decode int16 negative (sign extension)", () => {
      const decoder = makeDecoder("int16");
      expect(decoder.decode(ptr(0x8000))).toEqual({ type: "int16", value: -32768 });
    });

    it("should decode uint16", () => {
      const decoder = makeDecoder("uint16");
      expect(decoder.decode(ptr(0xffff))).toEqual({ type: "uint16", value: 65535 });
    });

    it("should decode int", () => {
      const decoder = makeDecoder("int");
      expect(decoder.decode(ptr(42))).toEqual({ type: "int", value: 42 });
    });

    it("should decode int32", () => {
      const decoder = makeDecoder("int32");
      expect(decoder.decode(ptr(1000))).toEqual({ type: "int32", value: 1000 });
    });

    it("should decode ssize_t (word-sized: number on ILP32, decimal string on LP64)", () => {
      const decoder = makeDecoder("ssize_t");
      const expected = Process.pointerSize < 8 ? 42 : "42";
      expect(decoder.decode(ptr(42))).toEqual({ type: "ssize_t", value: expected });
    });

    it("should decode long (word-sized: number on ILP32, decimal string on LP64)", () => {
      const decoder = makeDecoder("long");
      const expected = Process.pointerSize < 8 ? 100 : "100";
      expect(decoder.decode(ptr(100))).toEqual({ type: "long", value: expected });
    });

    it("should decode a negative long correctly on LP64 targets (regression test: this used to saturate to Int64.MAX instead of wrapping around)", () => {
      const decoder = makeDecoder("long");
      if (Process.pointerSize < 8) {
        // toInt32() already interprets the bit pattern as signed correctly; only the LP64
        // (string round-trip through int64()) path was affected by this bug.
        expect(decoder.decode(ptr(0x80000000))).toEqual({ type: "long", value: -2147483648 });
        return;
      }
      // 0xffffffff80000000 is -2147483648 sign-extended to 64 bits.
      expect(decoder.decode(ptr("0xffffffff80000000"))).toEqual({ type: "long", value: "-2147483648" });
    });

    it("should decode uint", () => {
      const decoder = makeDecoder("uint");
      expect(decoder.decode(ptr(0xffff))).toEqual({ type: "uint", value: 65535 });
    });

    it("should decode uint32", () => {
      const decoder = makeDecoder("uint32");
      expect(decoder.decode(ptr(1000))).toEqual({ type: "uint32", value: 1000 });
    });

    it("should decode size_t (word-sized: number on ILP32, decimal string on LP64)", () => {
      const decoder = makeDecoder("size_t");
      const expected = Process.pointerSize < 8 ? 1024 : "1024";
      expect(decoder.decode(ptr(1024))).toEqual({ type: "size_t", value: expected });
    });

    it("should decode ulong (word-sized: number on ILP32, decimal string on LP64)", () => {
      const decoder = makeDecoder("ulong");
      const expected = Process.pointerSize < 8 ? 999 : "999";
      expect(decoder.decode(ptr(999))).toEqual({ type: "ulong", value: expected });
    });

    it("should decode int64 as a decimal string to preserve full precision", () => {
      const decoder = makeDecoder("int64");
      const result = decoder.decode(ptr(12345));
      expect(result.type).toBe("int64");
      expect(result.value).toBe("12345");
    });

    it("should decode a negative int64 correctly (regression test: this used to saturate to Int64.MAX instead of wrapping around)", () => {
      const decoder = makeDecoder("int64");
      // 0x8000000000000001 is -9223372036854775807 in two's complement.
      const result = decoder.decode(ptr("0x8000000000000001"));
      expect(result.type).toBe("int64");
      expect(result.value).toBe("-9223372036854775807");
    });

    it("should decode -1 as int64 correctly (all bits set)", () => {
      const decoder = makeDecoder("int64");
      const result = decoder.decode(ptr("0xffffffffffffffff"));
      expect(result.type).toBe("int64");
      expect(result.value).toBe("-1");
    });

    it("should decode uint64 as a decimal string to preserve full precision", () => {
      const decoder = makeDecoder("uint64");
      const result = decoder.decode(ptr(12345));
      expect(result.type).toBe("uint64");
      expect(result.value).toBe("12345");
    });

    it("should decode float via IEEE-754 bit reinterpretation", () => {
      const decoder = makeDecoder("float");
      // 0x3f800000 is the IEEE-754 single-precision bit pattern for 1.0
      expect(decoder.decode(ptr(0x3f800000))).toEqual({ type: "float", value: 1 });
    });

    it("should decode double via IEEE-754 bit reinterpretation", () => {
      const decoder = makeDecoder("double");
      // 0x3ff0000000000000 is the IEEE-754 double-precision bit pattern for 1.0
      expect(decoder.decode(ptr("0x3ff0000000000000"))).toEqual({ type: "double", value: 1 });
    });

    it("should keep the declared type label distinct from the type used to select the decoder", () => {
      // Mirrors what NativeDecoderResolver does for an alias like "unsigned int": the
      // canonical FridaFundamentalType ("uint") drives decoding, but the decodable's own
      // `type` (as originally declared) is what's echoed back in the decoded value.
      const decoder = new NativeValueDecoder({ type: "unsigned int", settings: DEFAULT_DECODER_SETTINGS }, "uint");
      expect(decoder.decode(ptr(0xffff))).toEqual({ type: "unsigned int", value: 65535 });
    });

    it("should cache the value decoder on second call", () => {
      const decoder = makeDecoder("int32");
      decoder.decode(ptr(1));
      expect((decoder as any).cachedValueDecoder).not.toBeNull();
      expect(decoder.decode(ptr(99))).toEqual({ type: "int32", value: 99 });
    });
  });
});
