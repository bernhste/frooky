import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { acceptedNativeDecoderArgs, NativeDecoderResolver } from "./nativeDecoderResolver";
import { NativeFallbackDecoder } from "./nativeFallbackDecoder";
import { NativeReferenceDecoder } from "./nativeReferenceDecoder";
import { NativeStringDecoder } from "./nativeStringDecoder";
import { NativeValueDecoder } from "./nativeValueDecoder";

describe("NativeDecoderResolver", () => {
  describe("resolveDecoder()", () => {
    it("should resolve a fundamental type to a NativeValueDecoder", () => {
      const decoder = NativeDecoderResolver.resolveDecoder({ type: "int", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder instanceof NativeValueDecoder).toBeTruthy();
      expect(decoder.decode(ptr(42))).toEqual({ type: "int", value: 42 });
    });

    it("should decode a fundamental type alias using its canonical decoder, while echoing back the declared type string", () => {
      const decoder = NativeDecoderResolver.resolveDecoder({ type: "unsigned int", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder instanceof NativeValueDecoder).toBeTruthy();
      // "unsigned int" is decoded as "uint", but the declared type is returned
      expect(decoder.decode(ptr(0xffff))).toEqual({ type: "unsigned int", value: 65535 });
    });

    it("should preserve the declared name alongside the decoded value", () => {
      const decoder = NativeDecoderResolver.resolveDecoder({ type: "int", name: "count", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(7))).toEqual({ type: "int", name: "count", value: 7 });
    });

    it("should resolve a pointer type to a NativeReferenceDecoder", () => {
      const scratch = Memory.alloc(16);
      scratch.writeUtf8String("hello");
      const decoder = NativeDecoderResolver.resolveDecoder({ type: "char*", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder instanceof NativeReferenceDecoder).toBeTruthy();
      expect(decoder.decode(scratch)).toEqual({ type: "char*", value: "hello" });
    });

    it("should resolve a pointer type spelled with a normalized alias base type", () => {
      const scratch = Memory.alloc(1);
      scratch.writeU8(1);
      const decoder = NativeDecoderResolver.resolveDecoder({ type: "_Bool *", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder instanceof NativeReferenceDecoder).toBeTruthy();
      expect(decoder.decode(scratch)).toEqual({ type: "_Bool *", value: true });
    });

    it("should fall back to NativeFallbackDecoder for an unrecognized fundamental type", () => {
      const decoder = NativeDecoderResolver.resolveDecoder({ type: "SomeStruct", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder instanceof NativeFallbackDecoder).toBeTruthy();
      expect(decoder.decode(ptr(0x12345678))).toEqual({ type: "SomeStruct", value: "0x12345678" });
    });

    it("should fall back to NativeFallbackDecoder for a pointer to an unrecognized base type", () => {
      const decoder = NativeDecoderResolver.resolveDecoder({ type: "MyStruct*", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder instanceof NativeFallbackDecoder).toBeTruthy();
      expect(decoder.decode(ptr(0x12345678))).toEqual({ type: "MyStruct*", value: "0x12345678" });
    });

    it("should resolve `decoder: string` to a NativeStringDecoder regardless of the declared type", () => {
      const decoder = NativeDecoderResolver.resolveDecoder({ type: "void *", settings: { ...DEFAULT_DECODER_SETTINGS, decoder: "string" } });
      expect(decoder instanceof NativeStringDecoder).toBeTruthy();
      expect(decoder.decode(Memory.allocUtf8String("hello"))).toEqual({ type: "void *", value: "hello" });
    });

    it("should throw a descriptive error for an unknown custom decoder", () => {
      expect(() => NativeDecoderResolver.resolveDecoder({ type: "void *", settings: { ...DEFAULT_DECODER_SETTINGS, decoder: "nope" } })).toThrow(
        'Unknown custom decoder: "nope"',
      );
    });

    describe("acceptedNativeDecoderArgs()", () => {
      const accepted = (type: string, decoder?: string) => acceptedNativeDecoderArgs({ type, settings: { ...DEFAULT_DECODER_SETTINGS, decoder } });

      it("accepts length and offset for pointers to fundamental types and decoder: string", () => {
        expect(accepted("const char *")).toEqual(["length", "offset"]);
        expect(accepted("int **")).toEqual(["length", "offset"]);
        expect(accepted("void *", "string")).toEqual(["length", "offset"]);
      });

      it("accepts offset for decoder: nullTerminated", () => {
        expect(accepted("char **", "nullTerminated")).toEqual(["offset"]);
      });

      it("accepts no roles for values, unknown types and the other decoders", () => {
        expect(accepted("int")).toEqual([]);
        expect(accepted("SSL *")).toEqual([]);
        expect(accepted("int", "fd")).toEqual([]);
        expect(accepted("int", "openFlags")).toEqual([]);
      });
    });
  });
});
