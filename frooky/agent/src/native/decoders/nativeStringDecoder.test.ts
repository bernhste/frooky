import { DecoderArgValues } from "../../shared/decoders/decoderArgs";
import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { DecoderSettings } from "../../shared/frookySettings";
import { NativeStringDecoder } from "./nativeStringDecoder";

const makeDecoder = (settings: DecoderSettings = DEFAULT_DECODER_SETTINGS): NativeStringDecoder =>
  new NativeStringDecoder({ type: "void *", name: "buf", settings: { ...settings, decoder: "string" } });

const lengthArg = (value: unknown): DecoderArgValues => ({ length: value });

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

    it("should decode a buffer that isn't NUL-terminated using the length", () => {
      const buffer = writeBytes([0x61, 0x62, 0x63, 0x64, 0x65]);
      expect(makeDecoder().decode(buffer, lengthArg(3)).value).toBe("abc");
    });

    it("should accept a length decoded as a decimal string (size_t on LP64)", () => {
      const buffer = writeBytes([0x61, 0x62, 0x63]);
      expect(makeDecoder().decode(buffer, lengthArg("2")).value).toBe("ab");
    });

    it("should decode NUL bytes inside the length instead of stopping at them", () => {
      const buffer = writeBytes([0x61, 0x62, 0x00, 0x63, 0x64]);
      expect(makeDecoder().decode(buffer, lengthArg(5)).value).toBe("ab.cd");
    });

    it("should cap the length at maxItems and append an ellipsis", () => {
      const buffer = writeBytes([0x61, 0x62, 0x63, 0x64, 0x65]);
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 2 });
      expect(decoder.decode(buffer, lengthArg(5)).value).toBe("ab...");
    });

    it("should decode an empty string for a length of 0", () => {
      expect(makeDecoder().decode(writeBytes([0x61]), lengthArg(0)).value).toBe("");
    });

    it("should skip the bytes of the role offset", () => {
      const buffer = writeBytes([0x2d, 0x61, 0x62, 0x63, 0x00]);
      expect(makeDecoder().decode(buffer, { offset: 1 }).value).toBe("abc");
      expect(makeDecoder().decode(buffer, { offset: 1, length: 2 }).value).toBe("ab");
    });

    it("should decode a NULL pointer as null", () => {
      expect(makeDecoder().decode(ptr(0)).value).toBe(null);
    });

    it("should decode as null and warn when the length isn't a number", () => {
      expect(makeDecoder().decode(Memory.allocUtf8String("abc"), lengthArg("abc")).value).toBe(null);
    });

    it("should decode an empty C string without truncation", () => {
      expect(makeDecoder().decode(Memory.allocUtf8String("")).value).toBe("");
    });

    it("should decode an empty C string when maxItems is 0", () => {
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 0 });
      expect(decoder.decode(Memory.allocUtf8String("")).value).toBe("");
    });

    it("should truncate a non-empty C string when maxItems is 0", () => {
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 0 });
      expect(decoder.decode(Memory.allocUtf8String("abc")).value).toBe("...");
    });

    it("should truncate a single-character C string to 1 item when maxItems is 1", () => {
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 1 });
      expect(decoder.decode(Memory.allocUtf8String("a")).value).toBe("a");
      expect(decoder.decode(Memory.allocUtf8String("ab")).value).toBe("a...");
    });

    it("should decode a large C string that crosses memory page boundaries", () => {
      const largeText = "x".repeat(5000);
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 6000 });
      expect(decoder.decode(Memory.allocUtf8String(largeText)).value).toBe(largeText);
    });

    it("should truncate a large C string that crosses page boundaries", () => {
      const largeText = "x".repeat(5000);
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 4500 });
      expect(decoder.decode(Memory.allocUtf8String(largeText)).value).toBe("x".repeat(4500) + "...");
    });

    it("should decode a C string placed directly across a memory page boundary", () => {
      const pageSize = Process.pageSize;
      const mem = Memory.alloc(pageSize * 2);
      const offsetInPage = mem.and(pageSize - 1).toUInt32();
      const pageBoundary = mem.add(pageSize - offsetInPage);
      // Place string starting 4 bytes before the boundary: 4 bytes in page 1, 6 bytes in page 2
      const strPtr = pageBoundary.sub(4);
      strPtr.writeUtf8String("ABCDEFGHIJ");

      expect(makeDecoder().decode(strPtr).value).toBe("ABCDEFGHIJ");

      const truncDecoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 6 });
      expect(truncDecoder.decode(strPtr).value).toBe("ABCDEF...");

      const exactPageDecoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 4 });
      expect(exactPageDecoder.decode(strPtr).value).toBe("ABCD...");

      strPtr.writeUtf8String("ABCD");
      expect(makeDecoder().decode(strPtr).value).toBe("ABCD");
    });
  });
});

export {};
