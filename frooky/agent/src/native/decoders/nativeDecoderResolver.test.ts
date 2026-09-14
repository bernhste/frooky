import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { NativeDecoderResolver } from "./nativeDecoderResolver";
import { NativeFallbackDecoder } from "./nativeFallbackDecoder";
import { NativeReferenceDecoder } from "./nativeReferenceDecoder";
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
      // "unsigned int" isn't a FridaFundamentalType key itself - it's resolved through the
      // alias table to "uint" for decoding, but the declared string is what's echoed back.
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
  });
});
