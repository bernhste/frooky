import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { NativeValueDecoder } from "./nativeValueDecoder";

describe("NativeValueDecoder", () => {
  describe("decode()", () => {
    it("should decode void as null", () => {
      const decoder = new NativeValueDecoder({ type: "void", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(0))).toEqual({ declaredType: "void", value: null });
    });

    it("should decode bool true", () => {
      const decoder = new NativeValueDecoder({ type: "bool", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(1))).toEqual({ declaredType: "bool", value: true });
    });

    it("should decode bool false", () => {
      const decoder = new NativeValueDecoder({ type: "bool", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(0))).toEqual({ declaredType: "bool", value: false });
    });

    it("should decode char positive", () => {
      const decoder = new NativeValueDecoder({ type: "char", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(65))).toEqual({ declaredType: "char", value: 65 });
    });

    it("should decode char negative (sign extension)", () => {
      const decoder = new NativeValueDecoder({ type: "char", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(0xff))).toEqual({ declaredType: "char", value: -1 });
    });

    it("should decode int8 positive", () => {
      const decoder = new NativeValueDecoder({ type: "int8", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(127))).toEqual({ declaredType: "int8", value: 127 });
    });

    it("should decode int8 negative", () => {
      const decoder = new NativeValueDecoder({ type: "int8", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(0x80))).toEqual({ declaredType: "int8", value: -128 });
    });

    it("should decode uchar", () => {
      const decoder = new NativeValueDecoder({ type: "uchar", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(0xff))).toEqual({ declaredType: "uchar", value: 255 });
    });

    it("should decode uint8", () => {
      const decoder = new NativeValueDecoder({ type: "uint8", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(0xff))).toEqual({ declaredType: "uint8", value: 255 });
    });

    it("should decode int16 positive", () => {
      const decoder = new NativeValueDecoder({ type: "int16", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(32767))).toEqual({ declaredType: "int16", value: 32767 });
    });

    it("should decode int16 negative (sign extension)", () => {
      const decoder = new NativeValueDecoder({ type: "int16", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(0x8000))).toEqual({ declaredType: "int16", value: -32768 });
    });

    it("should decode uint16", () => {
      const decoder = new NativeValueDecoder({ type: "uint16", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(0xffff))).toEqual({ declaredType: "uint16", value: 65535 });
    });

    it("should decode int", () => {
      const decoder = new NativeValueDecoder({ type: "int", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(42))).toEqual({ declaredType: "int", value: 42 });
    });

    it("should decode int32", () => {
      const decoder = new NativeValueDecoder({ type: "int32", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(1000))).toEqual({ declaredType: "int32", value: 1000 });
    });

    it("should decode ssize_t", () => {
      const decoder = new NativeValueDecoder({ type: "ssize_t", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(42))).toEqual({ declaredType: "ssize_t", value: 42 });
    });

    it("should decode long", () => {
      const decoder = new NativeValueDecoder({ type: "long", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(100))).toEqual({ declaredType: "long", value: 100 });
    });

    it("should decode uint", () => {
      const decoder = new NativeValueDecoder({ type: "uint", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(0xffff))).toEqual({ declaredType: "uint", value: 65535 });
    });

    it("should decode uint32", () => {
      const decoder = new NativeValueDecoder({ type: "uint32", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(1000))).toEqual({ declaredType: "uint32", value: 1000 });
    });

    it("should decode size_t", () => {
      const decoder = new NativeValueDecoder({ type: "size_t", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(1024))).toEqual({ declaredType: "size_t", value: 1024 });
    });

    it("should decode ulong", () => {
      const decoder = new NativeValueDecoder({ type: "ulong", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(999))).toEqual({ declaredType: "ulong", value: 999 });
    });

    it("should decode int64", () => {
      const decoder = new NativeValueDecoder({ type: "int64", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(ptr(12345));
      expect(result.declaredType).toBe("int64");
      expect(result.value).toBe(12345);
    });

    it("should decode uint64", () => {
      const decoder = new NativeValueDecoder({ type: "uint64", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(ptr(12345));
      expect(result.declaredType).toBe("uint64");
      expect(result.value).toBe(12345);
    });

    it("should decode float (raw int32 of pointer address)", () => {
      const decoder = new NativeValueDecoder({ type: "float", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(42))).toEqual({ declaredType: "float", value: 42 });
    });

    it("should decode double (raw int32 of pointer address)", () => {
      const decoder = new NativeValueDecoder({ type: "double", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(42))).toEqual({ declaredType: "double", value: 42 });
    });

    it("should cache the value decoder on second call", () => {
      const decoder = new NativeValueDecoder({ type: "int32", settings: DEFAULT_DECODER_SETTINGS });
      decoder.decode(ptr(1));
      expect((decoder as any).cachedValueDecoder).not.toBeNull();
      expect(decoder.decode(ptr(99))).toEqual({ declaredType: "int32", value: 99 });
    });
  });
});
