import { Decoder } from "../../shared/decoders/baseDecoder";
import { Decodable } from "../../shared/decoders/decodable";
import { DecoderResolver } from "../../shared/decoders/decoderResolver";
import { NativeFallbackDecoder } from "./nativeFallbackDecoder";
import { parseNativeFridaType } from "./nativeFridaType";
import { NativeReferenceDecoder } from "./nativeReferenceDecoder";
import { NativeStringDecoder } from "./nativeStringDecoder";
import { NativeValueDecoder } from "./nativeValueDecoder";

type NativeDecoderConstructor = { new (decodable: Decodable): Decoder<NativePointer> };

const CUSTOM_DECODER_REGISTRY: Record<string, NativeDecoderConstructor> = {
  string: NativeStringDecoder,
};

// resolves the decode based on a decodable type
export const NativeDecoderResolver: DecoderResolver<NativePointer> = {
  resolveDecoder(decodable: Decodable): Decoder<NativePointer> {
    if (decodable.settings.decoder) {
      const CustomDecoderClass = CUSTOM_DECODER_REGISTRY[decodable.settings.decoder];
      if (!CustomDecoderClass) {
        throw new Error(`Unknown custom decoder: "${decodable.settings.decoder}"`);
      }
      return new CustomDecoderClass(decodable);
    }
    const nativeFridaType = parseNativeFridaType(decodable.type);
    if (!nativeFridaType) {
      // it was not possible to resolve a decoder
      return new NativeFallbackDecoder(decodable);
    }
    if (typeof nativeFridaType === "object") {
      // the declared type is a reference (e.g. 'char*', 'void *')
      return new NativeReferenceDecoder(decodable, nativeFridaType);
    } else {
      // the declared type is a fundamental (e.g. 'int'); `decodable` is kept as-is (not
      // rewritten to the canonical type name) so decoded output reflects what was declared.
      return new NativeValueDecoder(decodable, nativeFridaType);
    }
  },
};
