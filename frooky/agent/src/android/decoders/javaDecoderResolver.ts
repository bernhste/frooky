import type Java from "frida-java-bridge";
import { Decoder } from "../../shared/decoders/baseDecoder";
import { Decodable } from "../../shared/decoders/decodable";
import { DecoderResolver } from "../../shared/decoders/decoderResolver";
import { IntentFlagDecoder } from "./android/content/IntentFlagDecoder";
import { IntentUriFlagDecoder } from "./android/content/IntentUriFlagDecoder";
import { ArrayDecoder } from "./builtin/ArrayDecoder";
import { ConstantDecoder } from "./builtin/ConstantDecoder";
import { GetterDecoder } from "./builtin/GetterDecoder";
import { HashCodeDecoder } from "./builtin/HashCodeDecoder";
import { OverrideDecoder } from "./builtin/OverrideDecoder";
import { PrimitiveDecoder } from "./builtin/PrimitiveDecoder";
import { ReferenceTypeDecoder } from "./builtin/ReferenceTypeDecoder";
import { StringDecoder } from "./builtin/StringDecoder";

export type DecoderConstructor = { new (decodable: Decodable): Decoder<Java.Wrapper> };

// created on first use: GetterDecoder imports this module through decodeGetterValues()
let customDecoderRegistry: Record<string, DecoderConstructor> | undefined;
function getCustomDecoderRegistry(): Record<string, DecoderConstructor> {
  return (customDecoderRegistry ??= {
    string: StringDecoder,
    hashCode: HashCodeDecoder,
    intentFlag: IntentFlagDecoder,
    intentUriFlag: IntentUriFlagDecoder,
    constant: ConstantDecoder,
    getters: GetterDecoder,
  });
}

export const JAVA_PRIMITIVE_TYPES = new Set(["int", "long", "short", "byte", "char", "boolean", "float", "double"]);

// The default decoder of a declared type.
function resolveTypeDecoder(decodable: Decodable): Decoder<Java.Wrapper> {
  if (decodable.type.startsWith("[")) {
    return new ArrayDecoder(decodable);
  } else if (JAVA_PRIMITIVE_TYPES.has(decodable.type) || decodable.type === "void" || decodable.type === "java.lang.String") {
    // Frida unwraps java.lang.String to a JS string
    return new PrimitiveDecoder(decodable);
  } else {
    // resolves the decoder by the runtime class when decode() is called
    return new ReferenceTypeDecoder(decodable);
  }
}

// Picks the decoder of a value: the custom decoder from its settings always wins, else the one for its declared type.
export const JavaDecoderResolver: DecoderResolver<Java.Wrapper> = {
  resolveDecoder(decodable: Decodable): Decoder<Java.Wrapper> {
    if (decodable.settings.decoder) {
      const CustomDecoderClass = getCustomDecoderRegistry()[decodable.settings.decoder];
      if (!CustomDecoderClass) {
        throw new Error(`Unknown custom decoder: "${decodable.settings.decoder}"`);
      }
      return new OverrideDecoder(decodable, new CustomDecoderClass(decodable), resolveTypeDecoder(decodable));
    }
    return resolveTypeDecoder(decodable);
  },
};
