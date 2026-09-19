import type { RuntimeInstance } from "frida-swift-bridge/dist/lib/types.js";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { Decodable } from "../../../shared/decoders/decodable";
import { DecoderResolver } from "../../../shared/decoders/decoderResolver";
import { SwiftFallbackDecoder } from "./builtin/SwiftFallbackDecoder";
import { SWIFT_PRIMITIVE_READERS, SwiftPrimitiveDecoder } from "./builtin/SwiftPrimitiveDecoder";
import { parseSwiftArrayElementType, SwiftArrayDecoder } from "./swift/SwiftArrayDecoder";
import { SwiftStringDecoder } from "./swift/SwiftStringDecoder";

export type SwiftDecoderConstructor = { new (decodable: Decodable): Decoder<RuntimeInstance> };

// resolved on first use: the array decoder resolves the decoders of its elements using this resolver
let customDecoderRegistry: Record<string, SwiftDecoderConstructor> | undefined;
function getCustomDecoderRegistry(): Record<string, SwiftDecoderConstructor> {
  return (customDecoderRegistry ??= {
    string: SwiftStringDecoder,
    array: SwiftArrayDecoder,
  });
}

// types of the standard library can be declared with or without the `Swift.` module prefix
function qualifySwiftType(type: string): string {
  const trimmed = type.trim();
  return trimmed.includes(".") ? trimmed : `Swift.${trimmed}`;
}

/**
 * resolves the decoder based on a decodable type
 */
export const SwiftDecoderResolver: DecoderResolver<RuntimeInstance> = {
  resolveDecoder(decodable: Decodable): Decoder<RuntimeInstance> {
    if (decodable.settings.decoder) {
      const CustomDecoderClass = getCustomDecoderRegistry()[decodable.settings.decoder];
      if (!CustomDecoderClass) {
        throw new Error(`Unknown custom decoder: "${decodable.settings.decoder}"`);
      }
      return new CustomDecoderClass(decodable);
    }

    if (parseSwiftArrayElementType(decodable.type)) return new SwiftArrayDecoder(decodable);

    const qualifiedType = qualifySwiftType(decodable.type);
    if (qualifiedType === "Swift.String") return new SwiftStringDecoder(decodable);
    if (qualifiedType in SWIFT_PRIMITIVE_READERS) return new SwiftPrimitiveDecoder({ ...decodable, type: qualifiedType });
    return new SwiftFallbackDecoder(decodable);
  },
};
