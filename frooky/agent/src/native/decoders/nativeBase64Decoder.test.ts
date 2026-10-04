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
      expect(makeDecoder().decode(Memory.allocAnsiString("SGVsbG8="))).toEqual({ type: "void *", name: "buf", value: "Hello" });
    });

    it("should decode base64 containing UTF-8 characters", () => {
      // "grüezi 🙂" -> "Z3LDvGV6aSDwn5mC"
      expect(makeDecoder().decode(Memory.allocUtf8String("Z3LDvGV6aSDwn5mC")).value).toBe("grüezi 🙂");
    });

    it("should truncate decoded output longer than maxItems and append an ellipsis", () => {
      // "Hello World" -> "SGVsbG8gV29ybGQ="
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 5 });
      expect(decoder.decode(Memory.allocAnsiString("SGVsbG8gV29ybGQ=")).value).toBe("Hello...");
    });

    it("should not append an ellipsis when the decoded string is exactly maxItems long", () => {
      const decoder = makeDecoder({ ...DEFAULT_DECODER_SETTINGS, maxItems: 5 });
      expect(decoder.decode(Memory.allocAnsiString("SGVsbG8=")).value).toBe("Hello");
    });

    it("should decode a buffer using the length argument", () => {
      const str = "SGVsbG8=";
      const buffer = Memory.allocAnsiString(str);
      expect(makeDecoder().decode(buffer, lengthArg(str.length)).value).toBe("Hello");
    });

    it("should skip the bytes of the role offset", () => {
      const buffer = Memory.allocAnsiString("--SGVsbG8=--");
      expect(makeDecoder().decode(buffer, { offset: 2, length: 8 }).value).toBe("Hello");
    });

    it("should decode a NULL pointer as null", () => {
      expect(makeDecoder().decode(ptr(0)).value).toBe(null);
    });

    it("should decode as null and warn when base64 is invalid", () => {
      const warnSpy = spyOn(logger, "warn");
      try {
        expect(makeDecoder().decode(Memory.allocAnsiString("not-valid-base64*")).value).toBe(null);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should decode as null and warn when length isn't a number", () => {
      const warnSpy = spyOn(logger, "warn");
      try {
        expect(makeDecoder().decode(Memory.allocAnsiString("SGVsbG8="), lengthArg("abc")).value).toBe(null);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should decode as null without a warning when length is negative", () => {
      const warnSpy = spyOn(logger, "warn");
      try {
        expect(makeDecoder().decode(Memory.allocAnsiString("SGVsbG8="), lengthArg(-1)).value).toBe(null);
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});

export {};
