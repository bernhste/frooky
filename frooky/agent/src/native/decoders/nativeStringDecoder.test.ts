import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { DecoderSettings } from "../../shared/frookySettings";
import { NativeStringDecoder } from "./nativeStringDecoder";

const makeDecoder = (settings: DecoderSettings = DEFAULT_DECODER_SETTINGS): NativeStringDecoder =>
  new NativeStringDecoder({ type: "void *", name: "buf", settings: { ...settings, decoder: "string" } });

const lengthArg = (value: unknown): DecodedValue => ({ type: "size_t", value });

const writeBytes = (bytes: number[]): NativePointer => {
  const buffer = Memory.alloc(bytes.length);
  buffer.writeByteArray(bytes);
  return buffer;
};

describe("NativeStringDecoder", () => {
  describe("decode()", () => {
    it("should decode a NUL-terminated C string", () => {
      expect(makeDecoder().decode(Memory.allocUtf8String("hello"))).toEqual({ type: "void *", name: "buf", value: "hello" });
    });

    it("should decode a NUL-terminated UTF-8 string", () => {
      expect(makeDecoder().decode(Memory.allocUtf8String("grüezi 🙂")).value).toBe("grüezi 🙂");
    });

    it("should decode invalid UTF-8 as ASCII with placeholders", () => {
      expect(makeDecoder().decode(writeBytes([0x41, 0xff, 0x42, 0x00])).value).toBe("A.B");
    });

    it("should truncate a C string longer than maxItems and append an ellipsis", () => {
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 3 });
      expect(decoder.decode(Memory.allocUtf8String("abcdef")).value).toBe("abc...");
    });

    it("should drop a multi-byte UTF-8 character cut in half by maxItems instead of falling back to ASCII", () => {
      // "aü" is 0x61 0xc3 0xbc - a limit of 2 bytes cuts "ü" in half
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 2 });
      expect(decoder.decode(Memory.allocUtf8String("aüb")).value).toBe("a...");
    });

    it("should keep a multi-byte UTF-8 character that ends exactly at maxItems", () => {
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 3 });
      expect(decoder.decode(Memory.allocUtf8String("aüb")).value).toBe("aü...");
    });

    it("should not append an ellipsis when the C string is exactly maxItems long", () => {
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 3 });
      expect(decoder.decode(Memory.allocUtf8String("abc")).value).toBe("abc");
    });

    it("should decode a buffer that isn't NUL-terminated using the decoderArg as its length", () => {
      const buffer = writeBytes([0x61, 0x62, 0x63, 0x64, 0x65]);
      expect(makeDecoder().decode(buffer, lengthArg(3)).value).toBe("abc");
    });

    it("should accept a decoderArg decoded as a decimal string (size_t on LP64)", () => {
      const buffer = writeBytes([0x61, 0x62, 0x63]);
      expect(makeDecoder().decode(buffer, lengthArg("2")).value).toBe("ab");
    });

    it("should stop at a NUL byte inside the decoderArg length", () => {
      const buffer = writeBytes([0x61, 0x62, 0x00, 0x63, 0x64]);
      expect(makeDecoder().decode(buffer, lengthArg(5)).value).toBe("ab");
    });

    it("should cap the decoderArg length at maxItems and append an ellipsis", () => {
      const buffer = writeBytes([0x61, 0x62, 0x63, 0x64, 0x65]);
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 2 });
      expect(decoder.decode(buffer, lengthArg(5)).value).toBe("ab...");
    });

    it("should decode an empty string for a decoderArg length of 0", () => {
      expect(makeDecoder().decode(writeBytes([0x61]), lengthArg(0)).value).toBe("");
    });

    it("should decode a NULL pointer as null", () => {
      expect(makeDecoder().decode(ptr(0)).value).toBe(null);
    });

    it("should decode as null and warn when the decoderArg isn't a number", () => {
      expect(makeDecoder().decode(Memory.allocUtf8String("abc"), lengthArg("abc")).value).toBe(null);
    });
  });
});

export {};
