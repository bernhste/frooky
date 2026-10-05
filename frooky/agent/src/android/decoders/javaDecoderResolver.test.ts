import Java from "frida-java-bridge";
import { DecoderName } from "../../shared/frookySettings";
import { Decodable } from "../../shared/decoders/decodable";
import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { ArrayDecoder } from "./builtin/ArrayDecoder";
import { BitmaskDecoder } from "./builtin/BitmaskDecoder";
import { ConstantsDecoder } from "./builtin/ConstantsDecoder";
import { OverrideDecoder } from "./builtin/OverrideDecoder";
import { PrimitiveDecoder } from "./builtin/PrimitiveDecoder";
import { ReferenceTypeDecoder } from "./builtin/ReferenceTypeDecoder";
import { acceptedJavaDecoderArgs, JAVA_PRIMITIVE_TYPES, JavaDecoderResolver } from "./javaDecoderResolver";

function decodableOf(type: string, decoder?: DecoderName): Decodable {
  return { type, settings: { ...DEFAULT_DECODER_SETTINGS, decoder: decoder } };
}

describe("JavaDecoderResolver", () => {
  describe("resolveDecoder()", () => {
    it("resolves each registered custom decoder from settings.decoder", () => {
      const constantsDecoder = JavaDecoderResolver.resolveDecoder(decodableOf("int", "constants"));
      expect(constantsDecoder instanceof OverrideDecoder).toBeTruthy();
      expect(constantsDecoder.decoderName).toBe(new ConstantsDecoder(decodableOf("int")).decoderName);

      const bitmaskDecoder = JavaDecoderResolver.resolveDecoder(decodableOf("int", "bitmask"));
      expect(bitmaskDecoder.decoderName).toBe(new BitmaskDecoder(decodableOf("int")).decoderName);
    });

    it("prioritizes settings.decoder over the declared type", () => {
      // type "int" would normally resolve to PrimitiveDecoder
      const decoder = JavaDecoderResolver.resolveDecoder({
        type: "int",
        settings: { ...DEFAULT_DECODER_SETTINGS, decoder: "bitmask", config: { class: "android.content.Intent", fields: "FLAG_ACTIVITY_*" } },
      });

      // FLAG_RECEIVER_FOREGROUND has the same value
      expect(decoder.decode(0x10000000 as unknown as Java.Wrapper).value).toEqual(["FLAG_ACTIVITY_NEW_TASK"]);
    });

    it("prioritizes settings.decoder over a class decoder of the runtime class", () => {
      const Intent = Java.use("android.content.Intent");
      const intent = Intent.$new("android.intent.action.VIEW");

      const decoder = JavaDecoderResolver.resolveDecoder(decodableOf("android.content.Intent", "string"));

      expect(decoder.decode(intent).value).toBe(intent.toString());
    });

    it("resolves 'getters' to the getter decoder of any object", () => {
      const uri = Java.use("java.net.URI").create("https://example.org");
      const decoder = JavaDecoderResolver.resolveDecoder(decodableOf("java.net.URI", "getters"));

      expect(decoder.decoderName).toBe("GetterDecoder");
      expect((decoder.decode(uri).value as { name?: string; value: unknown }[]).find((p) => p.name === "host")?.value).toBe("example.org");
    });

    it("throws a descriptive error when settings.decoder names an unregistered decoder", () => {
      const call = () => JavaDecoderResolver.resolveDecoder(decodableOf("int", "not.a.real.Decoder" as DecoderName));
      expect(call).toThrow("not.a.real.Decoder" as DecoderName);
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

    describe("acceptedJavaDecoderArgs()", () => {
      const accepted = (type: string, decoder?: DecoderName) => acceptedJavaDecoderArgs({ type, settings: { ...DEFAULT_DECODER_SETTINGS, decoder } });

      it("accepts length and offset for arrays, and for decoder: string on byte[] and char[]", () => {
        expect(accepted("[B")).toEqual(["length", "offset"]);
        expect(accepted("[Ljava.lang.String;")).toEqual(["length", "offset"]);
        expect(accepted("[B", "string")).toEqual(["length", "offset"]);
        expect(accepted("[C", "string")).toEqual(["length", "offset"]);
        expect(accepted("[B", "base64")).toEqual(["length", "offset"]);
        expect(accepted("[C", "base64")).toEqual(["length", "offset"]);
      });

      it("accepts no roles for other types and decoders", () => {
        expect(accepted("int")).toEqual([]);
        expect(accepted("java.lang.String")).toEqual([]);
        expect(accepted("java.util.List")).toEqual([]);
        expect(accepted("java.lang.Object", "string")).toEqual([]);
        expect(accepted("[B", "hashCode")).toEqual([]);
      });
    });
  });
});
