import { Decodable } from "../../shared/decoders/decodable";
import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { IntentFlagDecoder } from "./android/content/IntentFlagDecoder";
import { IntentUriFlagDecoder } from "./android/content/IntentUriFlagDecoder";
import { ArrayDecoder } from "./builtin/ArrayDecoder";
import { PrimitiveDecoder } from "./builtin/PrimitiveDecoder";
import { ReferenceTypeDecoder } from "./builtin/ReferenceTypeDecoder";
import { JAVA_PRIMITIVE_TYPES, JavaDecoderResolver } from "./javaDecoderResolver";

function decodableOf(type: string, decoder?: string): Decodable {
  return { type, settings: { ...DEFAULT_DECODER_SETTINGS, decoder: decoder } };
}

describe("JavaDecoderResolver", () => {
  describe("resolveDecoder()", () => {
    it("resolves each registered custom decoder from settings.decoder", () => {
      const flagDecoder = JavaDecoderResolver.resolveDecoder(decodableOf("int", "intentFlag"));
      expect(flagDecoder instanceof IntentFlagDecoder).toBeTruthy();

      const uriFlagDecoder = JavaDecoderResolver.resolveDecoder(decodableOf("int", "intentUriFlag"));
      expect(uriFlagDecoder instanceof IntentUriFlagDecoder).toBeTruthy();
    });

    it("prioritizes settings.decoder over the declared type", () => {
      // type "int" would normally resolve to PrimitiveDecoder
      const decoder = JavaDecoderResolver.resolveDecoder(decodableOf("int", "intentFlag"));

      expect(decoder instanceof IntentFlagDecoder).toBeTruthy();
      expect(decoder instanceof PrimitiveDecoder).toBeFalsy();
    });

    it("throws a descriptive error when settings.decoder names an unregistered decoder", () => {
      const call = () => JavaDecoderResolver.resolveDecoder(decodableOf("int", "not.a.real.Decoder"));
      expect(call).toThrow("not.a.real.Decoder");
    });

    it("resolves JNI-style array types ('[' prefix) to ArrayDecoder", () => {
      const decoder = JavaDecoderResolver.resolveDecoder(decodableOf("[I"));
      expect(decoder instanceof ArrayDecoder).toBeTruthy();
    });

    it("resolves every declared java primitive type to PrimitiveDecoder", () => {
      for (const type of JAVA_PRIMITIVE_TYPES) {
        const decoder = JavaDecoderResolver.resolveDecoder(decodableOf(type));
        expect(decoder instanceof PrimitiveDecoder).toBeTruthy();
      }
    });

    it("resolves 'void' to PrimitiveDecoder", () => {
      const decoder = JavaDecoderResolver.resolveDecoder(decodableOf("void"));
      expect(decoder instanceof PrimitiveDecoder).toBeTruthy();
    });

    it("resolves 'java.lang.String' to PrimitiveDecoder", () => {
      const decoder = JavaDecoderResolver.resolveDecoder(decodableOf("java.lang.String"));
      expect(decoder instanceof PrimitiveDecoder).toBeTruthy();
    });

    it("resolves any other reference type to ReferenceTypeDecoder", () => {
      const decoder = JavaDecoderResolver.resolveDecoder(decodableOf("android.os.Bundle"));
      expect(decoder instanceof ReferenceTypeDecoder).toBeTruthy();
    });
  });
});
