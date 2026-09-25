import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { DecoderSettings } from "../../shared/frookySettings";
import { FridaFundamentalType } from "./nativeFridaType";
import { NativeReferenceDecoder } from "./nativeReferenceDecoder";

const makeDecoder = (pointee: FridaFundamentalType, settings: DecoderSettings = DEFAULT_DECODER_SETTINGS): NativeReferenceDecoder =>
  new NativeReferenceDecoder({ type: `${pointee}*`, settings }, { pointee, depth: 1 });

const decodedArg = (value: unknown): DecodedValue => ({ type: "int", value });

const writeWord = (ptr: NativePointer, value: number, signed: boolean): void => {
  if (Process.pointerSize < 8) {
    if (signed) {
      ptr.writeS32(value);
    } else {
      ptr.writeU32(value);
    }
  } else if (signed) {
    ptr.writeS64(value);
  } else {
    ptr.writeU64(value);
  }
};

const expectedWord = (value: number): number | string => (Process.pointerSize < 8 ? value : value.toString());

describe("NativeReferenceDecoder", () => {
  describe("decode()", () => {
    it("should decode bool true", () => {
      const scratch = Memory.alloc(1);
      scratch.writeU8(1);
      expect(makeDecoder("bool").decode(scratch)).toEqual({ type: "bool*", value: true });
    });

    it("should decode bool false", () => {
      const scratch = Memory.alloc(1);
      scratch.writeU8(0);
      expect(makeDecoder("bool").decode(scratch)).toEqual({ type: "bool*", value: false });
    });

    it("should decode int8", () => {
      const scratch = Memory.alloc(1);
      scratch.writeS8(-42);
      expect(makeDecoder("int8").decode(scratch)).toEqual({ type: "int8*", value: -42 });
    });

    it("should decode uint8", () => {
      const scratch = Memory.alloc(1);
      scratch.writeU8(200);
      expect(makeDecoder("uint8").decode(scratch)).toEqual({ type: "uint8*", value: 200 });
    });

    it("should decode int16", () => {
      const scratch = Memory.alloc(2);
      scratch.writeS16(-1234);
      expect(makeDecoder("int16").decode(scratch)).toEqual({ type: "int16*", value: -1234 });
    });

    it("should decode uint16", () => {
      const scratch = Memory.alloc(2);
      scratch.writeU16(60000);
      expect(makeDecoder("uint16").decode(scratch)).toEqual({ type: "uint16*", value: 60000 });
    });

    it("should decode int32", () => {
      const scratch = Memory.alloc(4);
      scratch.writeS32(-100000);
      expect(makeDecoder("int32").decode(scratch)).toEqual({ type: "int32*", value: -100000 });
    });

    it("should decode uint32", () => {
      const scratch = Memory.alloc(4);
      scratch.writeU32(4000000000);
      expect(makeDecoder("uint32").decode(scratch)).toEqual({ type: "uint32*", value: 4000000000 });
    });

    it("should decode ssize_t (4 bytes on ILP32, 8 bytes on LP64)", () => {
      const scratch = Memory.alloc(8);
      writeWord(scratch, 42, true);
      expect(makeDecoder("ssize_t").decode(scratch)).toEqual({ type: "ssize_t*", value: expectedWord(42) });
    });

    it("should decode long (4 bytes on ILP32, 8 bytes on LP64)", () => {
      const scratch = Memory.alloc(8);
      writeWord(scratch, 100, true);
      expect(makeDecoder("long").decode(scratch)).toEqual({ type: "long*", value: expectedWord(100) });
    });

    it("should decode size_t (4 bytes on ILP32, 8 bytes on LP64)", () => {
      const scratch = Memory.alloc(8);
      writeWord(scratch, 1024, false);
      expect(makeDecoder("size_t").decode(scratch)).toEqual({ type: "size_t*", value: expectedWord(1024) });
    });

    it("should decode ulong (4 bytes on ILP32, 8 bytes on LP64)", () => {
      const scratch = Memory.alloc(8);
      writeWord(scratch, 999, false);
      expect(makeDecoder("ulong").decode(scratch)).toEqual({ type: "ulong*", value: expectedWord(999) });
    });

    it("should decode int64 as a decimal string to preserve full precision", () => {
      const scratch = Memory.alloc(8);
      // -(2^53 + 1), outside the safe JS integer range - built from a string so the
      // test value itself isn't rounded before it even reaches the decoder.
      scratch.writeS64(int64("-9007199254740993"));
      expect(makeDecoder("int64").decode(scratch)).toEqual({ type: "int64*", value: "-9007199254740993" });
    });

    it("should decode uint64 as a decimal string to preserve full precision", () => {
      const scratch = Memory.alloc(8);
      scratch.writeU64(uint64("18446744073709551615")); // 2^64 - 1
      expect(makeDecoder("uint64").decode(scratch)).toEqual({ type: "uint64*", value: "18446744073709551615" });
    });

    it("should decode float", () => {
      const scratch = Memory.alloc(4);
      scratch.writeFloat(1.5);
      expect(makeDecoder("float").decode(scratch)).toEqual({ type: "float*", value: 1.5 });
    });

    it("should decode double", () => {
      const scratch = Memory.alloc(8);
      scratch.writeDouble(3.14159);
      expect(makeDecoder("double").decode(scratch)).toEqual({ type: "double*", value: 3.14159 });
    });

    it("should decode char* as a UTF-8 string when no length arg is given", () => {
      const scratch = Memory.alloc(16);
      scratch.writeUtf8String("hello");
      expect(makeDecoder("char").decode(scratch)).toEqual({ type: "char*", value: "hello" });
    });

    it("should cap an unbounded char* read at the configured maxItems", () => {
      const scratch = Memory.alloc(16);
      scratch.writeUtf8String("hello world");
      const decoder = makeDecoder("char", { ...DEFAULT_DECODER_SETTINGS, maxItems: 5 });
      expect(decoder.decode(scratch)).toEqual({ type: "char*", value: "hello" });
    });

    it("should decode uchar* as a UTF-8 string when no length arg is given", () => {
      const scratch = Memory.alloc(16);
      scratch.writeUtf8String("world");
      expect(makeDecoder("uchar").decode(scratch)).toEqual({ type: "uchar*", value: "world" });
    });

    it("should decode void* to hex/ascii using a numeric length arg", () => {
      const scratch = Memory.alloc(4);
      scratch.writeByteArray([0x41, 0x42, 0x43, 0x44]);
      const result = makeDecoder("void").decode(scratch, decodedArg(4));
      expect(result).toEqual({ type: "void*", value: ["0x41424344", "ABCD"] });
    });

    it("should decode void* using a decimal-string length arg (size_t-typed length regression)", () => {
      const scratch = Memory.alloc(4);
      scratch.writeByteArray([0x41, 0x42, 0x43, 0x44]);
      const result = makeDecoder("void").decode(scratch, decodedArg("4"));
      expect(result).toEqual({ type: "void*", value: ["0x41424344", "ABCD"] });
    });

    it("should clamp a void* length arg to the configured maxItems", () => {
      const scratch = Memory.alloc(10);
      scratch.writeByteArray([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a]);
      const decoder = makeDecoder("void", { ...DEFAULT_DECODER_SETTINGS, maxItems: 3 });
      const result = decoder.decode(scratch, decodedArg(10));
      expect(result).toEqual({ type: "void*", value: ["0x414243", "ABC"] });
    });

    it("should return null for void* when the length arg isn't a number or numeric string", () => {
      const scratch = Memory.alloc(4);
      const result = makeDecoder("void").decode(scratch, decodedArg("not-a-number"));
      expect(result).toEqual({ type: "void*", value: null });
    });

    it("should decode uchar* to hex/ascii using a numeric length arg", () => {
      const scratch = Memory.alloc(3);
      scratch.writeByteArray([0x58, 0x59, 0x5a]);
      const result = makeDecoder("uchar").decode(scratch, decodedArg(3));
      expect(result).toEqual({ type: "uchar*", value: ["0x58595a", "XYZ"] });
    });

    it("should cache the value decoder on second call", () => {
      const decoder = makeDecoder("int32");
      const first = Memory.alloc(4);
      first.writeS32(1);
      decoder.decode(first);
      expect((decoder as any).cachedDecoder).not.toBeNull();

      const second = Memory.alloc(4);
      second.writeS32(99);
      expect(decoder.decode(second)).toEqual({ type: "int32*", value: 99 });
    });
  });
});
