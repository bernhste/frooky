import { Decoder } from "../../shared/decoders/baseDecoder";
import { Decodable } from "../../shared/decoders/decodable";
import { DecoderArgRole } from "../../shared/decoders/decoderArgs";
import { DecoderResolver } from "../../shared/decoders/decoderResolver";
import { NativeEnumDecoder, NativeFlagsDecoder } from "./nativeConstantDecoder";
import { ENUM_PRESET_NAMES, FLAG_PRESET_NAMES, resolvePreset } from "./nativeConstantPresets";
import { NativeErrnoDecoder } from "./nativeErrnoDecoder";
import { NativeFallbackDecoder } from "./nativeFallbackDecoder";
import { NativeFdDecoder } from "./nativeFdDecoder";
import { parseNativeFridaType } from "./nativeFridaType";
import { NativeNullTerminatedArrayDecoder, NativeReferenceDecoder } from "./nativeReferenceDecoder";
import { NativeStringDecoder } from "./nativeStringDecoder";
import { isUtf16PointerType, NativeUtf16Decoder } from "./nativeUtf16Decoder";
import { NativeValueDecoder } from "./nativeValueDecoder";

type NativeDecoderFactory = (decodable: Decodable) => Decoder<NativePointer>;

// `decoder: nullTerminated` on a type that is no pointer to a fundamental type, e.g. `FILE **`, reads its
// elements as `void *`, so they are shown as addresses
const nullTerminatedArray: NativeDecoderFactory = (decodable) => {
  const fridaType = parseNativeFridaType(decodable.type);
  const depth = typeof fridaType === "object" ? fridaType.depth : (decodable.type.match(/\*/g)?.length ?? 1);
  return new NativeNullTerminatedArrayDecoder(decodable, typeof fridaType === "object" ? fridaType : { pointee: "void", depth });
};

// The default decoder of a declared type
function resolveTypeDecoder(decodable: Decodable): Decoder<NativePointer> {
  if (isUtf16PointerType(decodable.type)) {
    return new NativeUtf16Decoder(decodable);
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
}

const CUSTOM_DECODER_REGISTRY: Record<string, NativeDecoderFactory> = {
  string: (decodable) => new NativeStringDecoder(decodable),
  utf16: (decodable) => new NativeUtf16Decoder(decodable),
  errno: (decodable) => new NativeErrnoDecoder(decodable, resolveTypeDecoder(decodable)),
  fd: (decodable) => new NativeFdDecoder(decodable),
  enum: (decodable) => new NativeEnumDecoder(decodable),
  flags: (decodable) => new NativeFlagsDecoder(decodable),
  nullTerminated: nullTerminatedArray,
  ...Object.fromEntries(FLAG_PRESET_NAMES.map((name) => [name, (d: Decodable) => new NativeFlagsDecoder(d, resolvePreset(name) ?? null)])),
  ...Object.fromEntries(ENUM_PRESET_NAMES.map((name) => [name, (d: Decodable) => new NativeEnumDecoder(d, resolvePreset(name) ?? null)])),
};

// Picks the decoder of a value: the custom decoder from its settings, else by its declared type.
export const NativeDecoderResolver: DecoderResolver<NativePointer> = {
  resolveDecoder(decodable: Decodable): Decoder<NativePointer> {
    if (decodable.settings.decoder) {
      const createCustomDecoder = CUSTOM_DECODER_REGISTRY[decodable.settings.decoder];
      if (!createCustomDecoder) {
        throw new Error(`Unknown custom decoder: "${decodable.settings.decoder}"`);
      }
      return createCustomDecoder(decodable);
    }
    return resolveTypeDecoder(decodable);
  },
};

// The `decoderArgs` roles the decoder of a parameter accepts, see docs/decoders-native.md
export function acceptedNativeDecoderArgs(decodable: Decodable): readonly DecoderArgRole[] {
  const decoder = decodable.settings.decoder;
  if (decoder === "string" || decoder === "utf16") return ["length", "offset"];
  if (decoder === "nullTerminated") return ["offset"];
  if (decoder) return [];
  // pointers to fundamental types, e.g. `char *` or `int *`, and UTF-16 strings
  return typeof parseNativeFridaType(decodable.type) === "object" || isUtf16PointerType(decodable.type) ? ["length", "offset"] : [];
}
