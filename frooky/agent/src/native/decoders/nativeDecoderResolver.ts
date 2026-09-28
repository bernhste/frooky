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

// Picks the decoder of a value: the custom decoder from its settings, else by its declared type.
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
      // unknown type, e.g. a struct pointer
      return new NativeFallbackDecoder(decodable);
    }
    if (typeof nativeFridaType === "object") {
      // e.g. `char*`
      return new NativeReferenceDecoder(decodable, nativeFridaType);
    } else {
      // e.g. `int`; the output keeps the declared type name, not the Frida type
      return new NativeValueDecoder(decodable, nativeFridaType);
    }
  },
};
