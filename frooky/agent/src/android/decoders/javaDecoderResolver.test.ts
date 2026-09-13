import { Decodable } from "../../shared/decoders/decodable";
import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { IntentFlagDecoder } from "./android/content/IntentFlagDecoder";
import { IntentUriFlagDecoder } from "./android/content/IntentUriFlagsDecoder";
import { JavaArrayDecoder } from "./javaArrayDecoder";
import { JavaPrimitiveDecoder } from "./javaBasicDecoder";
import { JAVA_PRIMITIVE_TYPES, JavaDecoderResolver } from "./javaDecoderResolver";
import { JavaReferenceTypeDecoder } from "./javaReferenceTypeDecoder";

function decodableOf(type: string, customDecoder?: string): Decodable {
  return { type, settings: { ...DEFAULT_DECODER_SETTINGS, customDecoder } };
}

describe("JavaDecoderResolver", () => {
  describe("resolveDecoder()", () => {
    it("resolves each registered custom decoder from settings.customDecoder", () => {
      const flagDecoder = JavaDecoderResolver.resolveDecoder(decodableOf("int", "android.content.IntentFlagDecoder"));
      expect(flagDecoder instanceof IntentFlagDecoder).toBeTruthy();

      const uriFlagDecoder = JavaDecoderResolver.resolveDecoder(decodableOf("int", "android.content.IntentUriFlagDecoder"));
      expect(uriFlagDecoder instanceof IntentUriFlagDecoder).toBeTruthy();
    });

    it("prioritizes settings.customDecoder over the declared type", () => {
      // type "int" would normally resolve to JavaPrimitiveDecoder
      const decoder = JavaDecoderResolver.resolveDecoder(decodableOf("int", "android.content.IntentFlagDecoder"));

      expect(decoder instanceof IntentFlagDecoder).toBeTruthy();
      expect(decoder instanceof JavaPrimitiveDecoder).toBeFalsy();
    });

    it("throws a descriptive error when settings.customDecoder names an unregistered decoder", () => {
      const call = () => JavaDecoderResolver.resolveDecoder(decodableOf("int", "not.a.real.Decoder"));
      expect(call).toThrow("not.a.real.Decoder");
    });

    it("resolves JNI-style array types ('[' prefix) to JavaArrayDecoder", () => {
      const decoder = JavaDecoderResolver.resolveDecoder(decodableOf("[I"));
      expect(decoder instanceof JavaArrayDecoder).toBeTruthy();
    });

    it("resolves every declared java primitive type to JavaPrimitiveDecoder", () => {
      for (const type of JAVA_PRIMITIVE_TYPES) {
        const decoder = JavaDecoderResolver.resolveDecoder(decodableOf(type));
        expect(decoder instanceof JavaPrimitiveDecoder).toBeTruthy();
      }
    });

    it("resolves 'void' to JavaPrimitiveDecoder", () => {
      const decoder = JavaDecoderResolver.resolveDecoder(decodableOf("void"));
      expect(decoder instanceof JavaPrimitiveDecoder).toBeTruthy();
    });

    it("resolves 'java.lang.String' to JavaPrimitiveDecoder", () => {
      const decoder = JavaDecoderResolver.resolveDecoder(decodableOf("java.lang.String"));
      expect(decoder instanceof JavaPrimitiveDecoder).toBeTruthy();
    });

    it("resolves any other reference type to JavaReferenceTypeDecoder", () => {
      const decoder = JavaDecoderResolver.resolveDecoder(decodableOf("android.os.Bundle"));
      expect(decoder instanceof JavaReferenceTypeDecoder).toBeTruthy();
    });
  });
});
