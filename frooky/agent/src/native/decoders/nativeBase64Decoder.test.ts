import { DecoderArgValues } from "../../shared/decoders/decoderArgs";
import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { DecoderSettings } from "../../shared/frookySettings";
import { logger } from "../../shared/logger";
import { NativeBase64Decoder } from "./nativeBase64Decoder";

const makeDecoder = (settings: DecoderSettings = DEFAULT_DECODER_SETTINGS): NativeBase64Decoder =>
  new NativeBase64Decoder({ type: "void *", name: "buf", settings: { ...settings, decoder: "base64" } });

const lengthArg = (value: unknown): DecoderArgValues => ({ length: value });

describe("NativeBase64Decoder", () => {
  describe("decode()", () => {
    it("should decode a NUL-terminated base64 C string", () => {
      // "SGVsbG8=" -> "Hello"
      expect(makeDecoder().decode(Memory.allocUtf8String("SGVsbG8="))).toEqual({ type: "void *", name: "buf", value: "Hello" });
    });

    it("should decode base64 containing UTF-8 characters", () => {
      // "grüezi 🙂" -> "Z3LDvGV6aSDwn5mC"
      expect(makeDecoder().decode(Memory.allocUtf8String("Z3LDvGV6aSDwn5mC")).value).toBe("grüezi 🙂");
    });

    it("should truncate decoded output longer than maxItems and append an ellipsis", () => {
      // "Hello World" -> "SGVsbG8gV29ybGQ="
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 5 });
      expect(decoder.decode(Memory.allocUtf8String("SGVsbG8gV29ybGQ=")).value).toBe("Hello...");
    });

    it("should not append an ellipsis when the decoded string is exactly maxItems long", () => {
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 5 });
      expect(decoder.decode(Memory.allocUtf8String("SGVsbG8=")).value).toBe("Hello");
    });

    it("should decode a buffer using the length argument", () => {
      const str = "SGVsbG8=";
      const buffer = Memory.allocUtf8String(str);
      expect(makeDecoder().decode(buffer, lengthArg(str.length)).value).toBe("Hello");
    });

    it("should skip the bytes of the role offset", () => {
      const buffer = Memory.allocUtf8String("--SGVsbG8=--");
      expect(makeDecoder().decode(buffer, { offset: 2, length: 8 }).value).toBe("Hello");
    });

    it("should decode a NULL pointer as null", () => {
      expect(makeDecoder().decode(ptr(0)).value).toBe(null);
    });

    it("should decode binary data as hex", () => {
      // the bytes 0x00 to 0x0f, e.g. a key
      expect(makeDecoder().decode(Memory.allocUtf8String("AAECAwQFBgcICQoLDA0ODw==")).value).toBe("0x000102030405060708090a0b0c0d0e0f");
    });

    it("should read only as much of the buffer as maxItems needs", () => {
      // a length far beyond the allocation would fault if it was read in full
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 4 });
      expect(decoder.decode(Memory.allocUtf8String("SGVsbG8gV29ybGQ="), lengthArg(1_000_000_000)).value).toBe("Hell...");
    });

    it("should decode invalid base64 as a string and warn", () => {
      const warnSpy = spyOn(logger, "warn");
      try {
        expect(makeDecoder().decode(Memory.allocUtf8String("not-valid-base64*")).value).toBe("not-valid-base64*");
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should decode as null and warn when length isn't a number", () => {
      const warnSpy = spyOn(logger, "warn");
      try {
        expect(makeDecoder().decode(Memory.allocUtf8String("SGVsbG8="), lengthArg("abc")).value).toBe(null);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should decode as null without a warning when length is negative", () => {
      const warnSpy = spyOn(logger, "warn");
      try {
        expect(makeDecoder().decode(Memory.allocUtf8String("SGVsbG8="), lengthArg(-1)).value).toBe(null);
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});

export {};
