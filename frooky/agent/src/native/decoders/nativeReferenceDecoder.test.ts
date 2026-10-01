import { DecoderArgValues } from "../../shared/decoders/decoderArgs";
import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { DecoderSettings } from "../../shared/frookySettings";
import { FridaFundamentalType } from "./nativeFridaType";
import { NativeDecoderResolver } from "./nativeDecoderResolver";
import { NativeReferenceDecoder } from "./nativeReferenceDecoder";

const makeDecoder = (pointee: FridaFundamentalType, settings: DecoderSettings = DEFAULT_DECODER_SETTINGS): NativeReferenceDecoder =>
  new NativeReferenceDecoder({ type: `${pointee}*`, settings }, { pointee, depth: 1 });

const lengthArg = (value: unknown): DecoderArgValues => ({ length: value });

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
      // -(2^53 + 1), outside the safe JS integer range
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

    it("should decode char* as a UTF-8 string when no length is given", () => {
      const scratch = Memory.alloc(16);
      scratch.writeUtf8String("hello");
      expect(makeDecoder("char").decode(scratch)).toEqual({ type: "char*", value: "hello" });
    });

    it("should cap an unbounded char* read at the configured maxItems and append an ellipsis", () => {
      const scratch = Memory.alloc(16);
      scratch.writeUtf8String("hello world");
      const decoder = makeDecoder("char", { ...DEFAULT_DECODER_SETTINGS, maxItems: 5 });
      expect(decoder.decode(scratch)).toEqual({ type: "char*", value: "hello..." });
    });

    it("should use a char* length as the string length (via the native string decoder)", () => {
      const scratch = Memory.alloc(16);
      scratch.writeUtf8String("hello world");
      expect(makeDecoder("char").decode(scratch, lengthArg(4))).toEqual({ type: "char*", value: "hell" });
    });

    it("should decode uchar* as a UTF-8 string when no length is given", () => {
      const scratch = Memory.alloc(16);
      scratch.writeUtf8String("world");
      expect(makeDecoder("uchar").decode(scratch)).toEqual({ type: "uchar*", value: "world" });
    });

    it("should decode void* to hex using a numeric length", () => {
      const scratch = Memory.alloc(4);
      scratch.writeByteArray([0x41, 0x42, 0x43, 0x44]);
      const result = makeDecoder("void").decode(scratch, lengthArg(4));
      expect(result).toEqual({ type: "void*", value: "0x41424344" });
    });

    it("should decode void* using a decimal-string length (64-bit size_t)", () => {
      const scratch = Memory.alloc(4);
      scratch.writeByteArray([0x41, 0x42, 0x43, 0x44]);
      const result = makeDecoder("void").decode(scratch, lengthArg("4"));
      expect(result).toEqual({ type: "void*", value: "0x41424344" });
    });

    it("should clamp a void* length to the configured maxItems and append an ellipsis", () => {
      const scratch = Memory.alloc(10);
      scratch.writeByteArray([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a]);
      const decoder = makeDecoder("void", { ...DEFAULT_DECODER_SETTINGS, maxItems: 3 });
      const result = decoder.decode(scratch, lengthArg(10));
      expect(result).toEqual({ type: "void*", value: "0x414243..." });
    });

    it("should not append an ellipsis when the void* length is exactly maxItems", () => {
      const scratch = Memory.alloc(3);
      scratch.writeByteArray([0x41, 0x42, 0x43]);
      const decoder = makeDecoder("void", { ...DEFAULT_DECODER_SETTINGS, maxItems: 3 });
      expect(decoder.decode(scratch, lengthArg(3))).toEqual({ type: "void*", value: "0x414243" });
    });

    it("should return null for void* when the length isn't a number or numeric string", () => {
      const scratch = Memory.alloc(4);
      const result = makeDecoder("void").decode(scratch, lengthArg("not-a-number"));
      expect(result).toEqual({ type: "void*", value: null });
    });

    it("should decode uchar* to hex using a numeric length", () => {
      const scratch = Memory.alloc(3);
      scratch.writeByteArray([0x58, 0x59, 0x5a]);
      const result = makeDecoder("uchar").decode(scratch, lengthArg(3));
      expect(result).toEqual({ type: "uchar*", value: "0x58595a" });
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

  describe("pointer depth and arrays", () => {
    const makeDeepDecoder = (pointee: FridaFundamentalType, depth: number, settings: DecoderSettings = DEFAULT_DECODER_SETTINGS) =>
      new NativeReferenceDecoder({ type: `${pointee}${"*".repeat(depth)}`, settings }, { pointee, depth });

    // Memory.alloc() frees its memory once the JS object is garbage-collected, so the memory that only a
    // native pointer points to has to be referenced from here
    const keepAlive: NativePointer[] = [];
    const string = (text: string): NativePointer => {
      const allocated = Memory.allocUtf8String(text);
      keepAlive.push(allocated);
      return allocated;
    };

    // a pointer to `values`, each written as a pointer
    const pointerArray = (values: NativePointer[]): NativePointer => {
      const array = Memory.alloc(values.length * Process.pointerSize);
      keepAlive.push(array);
      values.forEach((value, i) => array.add(i * Process.pointerSize).writePointer(value));
      return array;
    };

    const intArray = (values: number[]): NativePointer => {
      const array = Memory.alloc(values.length * 4);
      keepAlive.push(array);
      values.forEach((value, i) => array.add(i * 4).writeS32(value));
      return array;
    };

    it("follows a char ** to its string", () => {
      const out = pointerArray([string("1.2.3")]);

      expect(makeDeepDecoder("char", 2).decode(out)).toEqual({ type: "char**", value: "1.2.3" });
    });

    it("follows an int ** to its int", () => {
      expect(makeDeepDecoder("int", 2).decode(pointerArray([intArray([42])]))).toEqual({ type: "int**", value: 42 });
    });

    it("follows a char *** through every level", () => {
      const out = pointerArray([pointerArray([string("deep")])]);

      expect(makeDeepDecoder("char", 3).decode(out).value).toBe("deep");
    });

    it("decodes a NULL pointer on any level as null", () => {
      expect(makeDeepDecoder("char", 2).decode(ptr(0)).value).toBeNull();
      expect(makeDeepDecoder("char", 2).decode(pointerArray([ptr(0)])).value).toBeNull();
      expect(makeDeepDecoder("int", 1).decode(ptr(0)).value).toBeNull();
    });

    it("decodes unreadable memory as null", () => {
      expect(makeDeepDecoder("int", 1).decode(ptr(0x10)).value).toBeNull();
    });

    it("decodes an int * with a length as an array of that many ints", () => {
      expect(makeDeepDecoder("int", 1).decode(intArray([3, 1, 4]), lengthArg(3))).toEqual({ type: "int*", value: [3, 1, 4] });
    });

    it("accepts the count as a decimal string (64-bit size_t)", () => {
      expect(makeDeepDecoder("int", 1).decode(intArray([3, 1, 4]), lengthArg("3")).value).toEqual([3, 1, 4]);
    });

    it("limits an array to maxItems elements", () => {
      const decoder = makeDeepDecoder("int", 1, { ...DEFAULT_DECODER_SETTINGS, maxItems: 2 });

      expect(decoder.decode(intArray([3, 1, 4]), lengthArg(3)).value).toEqual([3, 1, "[truncated at 2]"]);
    });

    it("steps by the size of the pointee", () => {
      const doubles = Memory.alloc(16);
      doubles.writeDouble(1.5);
      doubles.add(8).writeDouble(-2.25);
      const longs = Memory.alloc(16);
      longs.writeS64(-1);
      // not exactly representable as a JS number
      longs.add(8).writeS64(int64("9007199254740993"));

      expect(makeDeepDecoder("double", 1).decode(doubles, lengthArg(2)).value).toEqual([1.5, -2.25]);
      expect(makeDeepDecoder("int64", 1).decode(longs, lengthArg(2)).value).toEqual(["-1", "9007199254740993"]);
    });

    it("decodes a char ** with a length as an array of strings", () => {
      const strings = pointerArray([string("alpha"), ptr(0), string("gamma")]);

      expect(makeDeepDecoder("char", 2).decode(strings, lengthArg(3))).toEqual({ type: "char**", value: ["alpha", null, "gamma"] });
    });

    it("decodes a void ** with a length as the addresses it holds", () => {
      const pointers = pointerArray([ptr(0x1000), ptr(0)]);

      expect(makeDeepDecoder("void", 2).decode(pointers, lengthArg(2)).value).toEqual(["0x1000", null]);
    });

    it("keeps the length of a char * a length in bytes", () => {
      expect(makeDeepDecoder("char", 1).decode(Memory.allocUtf8String("abcdef"), lengthArg(3)).value).toBe("abc");
    });

    it("decodes a void * without a length as its address", () => {
      expect(makeDeepDecoder("void", 1).decode(ptr(0x1234)).value).toBe("0x1234");
    });

    it("decodes a buffer with a negative length, e.g. -1 when read fails, as null", () => {
      const buffer = Memory.allocUtf8String("abc");
      keepAlive.push(buffer);

      expect(makeDeepDecoder("void", 1).decode(buffer, lengthArg(-1)).value).toBeNull();
      expect(makeDeepDecoder("uchar", 1).decode(buffer, lengthArg(-1)).value).toBeNull();
      expect(makeDeepDecoder("char", 1).decode(buffer, lengthArg(-1)).value).toBeNull();
    });

    it("decodes an invalid count as null", () => {
      expect(makeDeepDecoder("int", 1).decode(intArray([1]), lengthArg("many")).value).toBeNull();
      expect(makeDeepDecoder("int", 1).decode(intArray([1]), lengthArg(-1)).value).toBeNull();
    });

    describe("the role offset", () => {
      it("skips that many elements of an array", () => {
        expect(makeDeepDecoder("int", 1).decode(intArray([3, 1, 4, 1]), { offset: 1, length: 2 }).value).toEqual([1, 4]);
        expect(makeDeepDecoder("char", 2).decode(pointerArray([string("a"), string("b")]), { offset: 1, length: 1 }).value).toEqual(["b"]);
      });

      it("skips that many bytes of a buffer or string", () => {
        const buffer = string("--secret--");
        expect(makeDeepDecoder("char", 1).decode(buffer, { offset: 2, length: 6 }).value).toBe("secret");
        expect(makeDeepDecoder("char", 1).decode(buffer, { offset: 2 }).value).toBe("secret--");
        expect(makeDeepDecoder("void", 1).decode(buffer, { offset: 2, length: 2 }).value).toBe("0x7365");
      });

      it("reads one element at the offset without a length", () => {
        expect(makeDeepDecoder("int", 1).decode(intArray([3, 1, 4]), { offset: 2 }).value).toBe(4);
      });
    });

    describe("decoder: nullTerminated", () => {
      const makeNullTerminatedDecoder = (type: string, maxItems = DEFAULT_DECODER_SETTINGS.maxItems) =>
        NativeDecoderResolver.resolveDecoder({ type, settings: { ...DEFAULT_DECODER_SETTINGS, maxItems, decoder: "nullTerminated" } });

      it("decodes a char ** up to its NULL pointer, like argv", () => {
        const argv = pointerArray([string("ls"), string("-l"), ptr(0), string("not read")]);

        expect(makeNullTerminatedDecoder("char *const *").decode(argv)).toEqual({ type: "char *const *", value: ["ls", "-l"] });
      });

      it("decodes a char * like without the decoder, up to its \\0", () => {
        expect(makeNullTerminatedDecoder("char *").decode(string("test")).value).toBe("test");
      });

      it("decodes an array declared with []", () => {
        expect(makeNullTerminatedDecoder("char *[]").decode(pointerArray([string("PATH=/bin"), ptr(0)])).value).toEqual(["PATH=/bin"]);
      });

      it("decodes an empty array and a NULL pointer", () => {
        expect(makeNullTerminatedDecoder("char **").decode(pointerArray([ptr(0)])).value).toEqual([]);
        expect(makeNullTerminatedDecoder("char **").decode(ptr(0)).value).toBeNull();
      });

      it("limits the array to maxItems elements", () => {
        const argv = pointerArray([string("a"), string("b"), string("c"), ptr(0)]);

        expect(makeNullTerminatedDecoder("char **", 2).decode(argv).value).toEqual(["a", "b", "[truncated at 2]"]);
        expect(makeNullTerminatedDecoder("char **", 3).decode(argv).value).toEqual(["a", "b", "c"]);
      });

      it("skips the first elements with the role offset", () => {
        const argv = pointerArray([string("ls"), string("-l"), ptr(0)]);

        expect(makeNullTerminatedDecoder("char **").decode(argv, { offset: 1 }).value).toEqual(["-l"]);
      });

      it("decodes the elements of an unknown pointer type as addresses", () => {
        expect(makeNullTerminatedDecoder("FILE **").decode(pointerArray([ptr(0x1000), ptr(0)])).value).toEqual(["0x1000"]);
      });
    });
  });
});
