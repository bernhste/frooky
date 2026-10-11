import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { DecoderOptions } from "../../../shared/frookySettings";
import { logger } from "../../../shared/logger";
import { ConstantsDecoder } from "./ConstantsDecoder";

describe("ConstantsDecoder", () => {
  describe("decode()", () => {
    const Cipher = Java.use("javax.crypto.Cipher");
    const decoder = new ConstantsDecoder({
      type: "int",
      declaringClass: "javax.crypto.Cipher",
      settings: DEFAULT_DECODER_SETTINGS,
    });

    it("should decode a value to the name of the matching constant declared on the same class", () => {
      const unwrapMode: number = Cipher.UNWRAP_MODE.value;

      const result = decoder.decode(unwrapMode as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "int", name: undefined, value: "UNWRAP_MODE" });
    });

    it("should fall back to the raw value when no declared constant matches", () => {
      const result = decoder.decode(-987654321 as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "int", name: undefined, value: -987654321 });
    });

    it("should fall back to the raw value when the declaring class is unknown", () => {
      const decoderWithoutClass = new ConstantsDecoder({ type: "int", settings: DEFAULT_DECODER_SETTINGS });

      const unwrapMode: number = Cipher.UNWRAP_MODE.value;
      const result = decoderWithoutClass.decode(unwrapMode as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "int", name: undefined, value: unwrapMode });
    });

    describe("with decoderOptions.class and decoderOptions.fields", () => {
      const withConfig = (config: DecoderOptions) =>
        new ConstantsDecoder({
          type: "int",
          declaringClass: "javax.crypto.Cipher",
          settings: { ...DEFAULT_DECODER_SETTINGS, decoderOptions: config },
        });

      it("should use the fields of the hooked class that match decoderOptions.fields", () => {
        const encryptMode: number = Cipher.ENCRYPT_MODE.value;
        const publicKey: number = Cipher.PUBLIC_KEY.value;

        // both are 1
        expect(withConfig({ fields: "*_MODE" }).decode(encryptMode as unknown as Java.Wrapper).value).toBe("ENCRYPT_MODE");
        expect(withConfig({ fields: "*_KEY" }).decode(publicKey as unknown as Java.Wrapper).value).toBe("PUBLIC_KEY");
      });

      it("should use the fields of decoderOptions.class instead of the hooked class", () => {
        const actionDown: number = Java.use("android.view.MotionEvent").ACTION_DOWN.value;

        expect(withConfig({ class: "android.view.MotionEvent", fields: "ACTION_*" }).decode(actionDown as unknown as Java.Wrapper).value).toBe(
          "ACTION_DOWN",
        );
      });

      it("should match a long, as Frida passes it and as a number", () => {
        const decoder = new ConstantsDecoder({
          type: "long",
          declaringClass: "org.example.Scheduler",
          settings: { ...DEFAULT_DECODER_SETTINGS, decoderOptions: { class: "android.text.format.DateUtils", fields: "*_IN_MILLIS" } },
        });
        const minute = Java.use("android.text.format.DateUtils").MINUTE_IN_MILLIS.value;

        expect(decoder.decode(minute as unknown as Java.Wrapper).value).toBe("MINUTE_IN_MILLIS");
        expect(decoder.decode(60000 as unknown as Java.Wrapper).value).toBe("MINUTE_IN_MILLIS");
      });

      it("should use every field of decoderOptions.class without decoderOptions.fields", () => {
        const unwrapMode: number = Cipher.UNWRAP_MODE.value;
        const decoder = new ConstantsDecoder({
          type: "int",
          declaringClass: "org.example.CryptoHelper",
          settings: { ...DEFAULT_DECODER_SETTINGS, decoderOptions: { class: "javax.crypto.Cipher" } },
        });

        expect(decoder.decode(unwrapMode as unknown as Java.Wrapper).value).toBe("UNWRAP_MODE");
      });

      it("should fall back to the raw value, with a warning, for a class that isn't found", () => {
        const warnSpy = spyOn(logger, "warn");
        try {
          expect(withConfig({ class: "com.example.Missing" }).decode(1 as unknown as Java.Wrapper).value).toBe(1);
          expect(warnSpy).toHaveBeenCalledTimes(1);
        } finally {
          warnSpy.mockRestore();
        }
      });
    });

    describe("with decoderOptions.constants", () => {
      const withConstants = (type: string, constants: Record<string, number>) =>
        new ConstantsDecoder({
          type,
          declaringClass: "javax.crypto.Cipher",
          settings: { ...DEFAULT_DECODER_SETTINGS, decoderOptions: { constants } },
        });

      it("should use decoderOptions.constants instead of the constants of the hooked class", () => {
        const decoder = withConstants("int", { MODE_ONE: 1, MODE_TWO: 2 });

        // 1 is Cipher.ENCRYPT_MODE, but decoderOptions.constants wins
        expect(decoder.decode(1 as unknown as Java.Wrapper).value).toBe("MODE_ONE");
      });

      it("should fall back to the raw value, not to the constants of the hooked class", () => {
        const unwrapMode: number = Cipher.UNWRAP_MODE.value;

        expect(withConstants("int", { OTHER: 99 }).decode(unwrapMode as unknown as Java.Wrapper).value).toBe(unwrapMode);
      });

      it("should match an int as 32 bits, so a constant can be written in hex", () => {
        expect(withConstants("int", { HIGH_BIT: 0x80000000 }).decode(-2147483648 as unknown as Java.Wrapper).value).toBe("HIGH_BIT");
      });

      it("should match long and byte values", () => {
        expect(withConstants("long", { BIG: 5000000000 }).decode(5000000000 as unknown as Java.Wrapper).value).toBe("BIG");
        expect(withConstants("byte", { MINUS_ONE: -1 }).decode(-1 as unknown as Java.Wrapper).value).toBe("MINUS_ONE");
      });

      it("should not match a value that isn't a number", () => {
        expect(withConstants("java.lang.String", { ONE: 1 }).decode("one" as unknown as Java.Wrapper).value).toBe("one");
      });
    });
  });
});
