import type Java from "frida-java-bridge";
import { Decoder } from "../../shared/decoders/baseDecoder";
import { Decodable } from "../../shared/decoders/decodable";
import { DecoderResolver } from "../../shared/decoders/decoderResolver";
import { IntentFlagDecoder } from "./android/content/IntentFlagDecoder";
import { IntentUriFlagDecoder } from "./android/content/IntentUriFlagDecoder";
import { ArrayDecoder } from "./builtin/ArrayDecoder";
import { ConstantDecoder } from "./builtin/ConstantDecoder";
import { HashCodeDecoder } from "./builtin/HashCodeDecoder";
import { PrimitiveDecoder } from "./builtin/PrimitiveDecoder";
import { ReferenceTypeDecoder } from "./builtin/ReferenceTypeDecoder";
import { StringDecoder } from "./builtin/StringDecoder";

export type DecoderConstructor = { new (decodable: Decodable): Decoder<Java.Wrapper> };

const CUSTOM_DECODER_REGISTRY: Record<string, DecoderConstructor> = {
  string: StringDecoder,
  hashCode: HashCodeDecoder,
  intentFlag: IntentFlagDecoder,
  intentUriFlag: IntentUriFlagDecoder,
  constant: ConstantDecoder,
};

export const JAVA_PRIMITIVE_TYPES = new Set(["int", "long", "short", "byte", "char", "boolean", "float", "double"]);

/**
 * resolves the decode based on a decodable type
 */
export const JavaDecoderResolver: DecoderResolver<Java.Wrapper> = {
  resolveDecoder(decodable: Decodable): Decoder<Java.Wrapper> {
    if (decodable.settings.decoder) {
      // return the custom decoder (if implemented)
      const CustomDecoderClass = CUSTOM_DECODER_REGISTRY[decodable.settings.decoder];
      if (!CustomDecoderClass) {
        throw new Error(`Unknown custom decoder: "${decodable.settings.decoder}"`);
      }
      return new CustomDecoderClass(decodable);
    } else if (decodable.type.startsWith("[")) {
      // java array decoder
      return new ArrayDecoder(decodable);
    } else if (JAVA_PRIMITIVE_TYPES.has(decodable.type) || decodable.type === "void" || decodable.type === "java.lang.String") {
      // other Java primitive types, void and strings (Frida unwraps java.lang.String automatically to JavaScript strings)
      return new PrimitiveDecoder(decodable);
    } else {
      // at this time we don't know the implementation class
      // this decoders resolves the implementation type at first time decode() is called
      return new ReferenceTypeDecoder(decodable);
    }
  },
};
