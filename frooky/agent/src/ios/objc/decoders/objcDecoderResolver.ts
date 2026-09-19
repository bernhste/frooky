import { Decoder } from "../../../shared/decoders/baseDecoder";
import { Decodable } from "../../../shared/decoders/decodable";
import { DecoderResolver } from "../../../shared/decoders/decoderResolver";
import { NativeValueDecoder } from "../../../native/decoders/nativeValueDecoder";
import { ObjcCStringDecoder } from "./builtin/ObjcCStringDecoder";
import { ObjcPointerDecoder } from "./builtin/ObjcPointerDecoder";
import { ObjcIntegerType, ObjcPrimitiveDecoder } from "./builtin/ObjcPrimitiveDecoder";
import { ObjcReferenceDecoder } from "./builtin/ObjcReferenceDecoder";
import { ObjcSelectorDecoder } from "./builtin/ObjcSelectorDecoder";
import { ObjcStringDecoder } from "./builtin/ObjcStringDecoder";
import { ObjcUnsupportedDecoder } from "./builtin/ObjcUnsupportedDecoder";
import { NSDataDecoder } from "./foundation/NSDataDecoder";

export type ObjcDecoderConstructor = { new (decodable: Decodable): Decoder<NativePointer> };

const CUSTOM_DECODER_REGISTRY: Record<string, ObjcDecoderConstructor> = {
  string: ObjcStringDecoder,
  data: NSDataDecoder,
};

const INTEGER_TYPES: Record<string, ObjcIntegerType> = {
  char: { bits: 8, signed: true },
  "unsigned char": { bits: 8, signed: false },
  short: { bits: 16, signed: true },
  "unsigned short": { bits: 16, signed: false },
  int: { bits: 32, signed: true },
  "unsigned int": { bits: 32, signed: false },
  long: { bits: 64, signed: true },
  "unsigned long": { bits: 64, signed: false },
  "long long": { bits: 64, signed: true },
  "unsigned long long": { bits: 64, signed: false },
  NSInteger: { bits: 64, signed: true },
  NSUInteger: { bits: 64, signed: false },
  size_t: { bits: 64, signed: false },
};

const BOOL_TYPES = new Set(["BOOL", "bool"]);
// CGFloat is a double on every 64-bit iOS device
const FLOAT_TYPES: Record<string, "float" | "double"> = { float: "float", double: "double", CGFloat: "double", NSTimeInterval: "double" };
const UNSUPPORTED_TYPES = new Set(["struct", "union", "array", "bitfield", "unknown"]);
const C_TYPES = new Set(["void", ...Object.keys(FLOAT_TYPES), ...Object.keys(INTEGER_TYPES), ...BOOL_TYPES, ...UNSUPPORTED_TYPES]);

/** `const NSString  *` -> `NSString*` */
export function normalizeObjcType(type: string): string {
  return type
    .replace(/\bconst\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/ ?\* ?/g, "*")
    .trim();
}

/** Returns `float` or `double` if the declared type is a floating point type, `undefined` otherwise. */
export function objcFloatType(type: string): "float" | "double" | undefined {
  return FLOAT_TYPES[normalizeObjcType(type)];
}

/**
 * resolves the decoder based on a decodable type
 */
export const ObjcDecoderResolver: DecoderResolver<NativePointer> = {
  resolveDecoder(decodable: Decodable): Decoder<NativePointer> {
    if (decodable.settings.decoder) {
      const CustomDecoderClass = CUSTOM_DECODER_REGISTRY[decodable.settings.decoder];
      if (!CustomDecoderClass) {
        throw new Error(`Unknown custom decoder: "${decodable.settings.decoder}"`);
      }
      return new CustomDecoderClass(decodable);
    }

    const type = normalizeObjcType(decodable.type);
    if (type in INTEGER_TYPES) return new ObjcPrimitiveDecoder(decodable, INTEGER_TYPES[type]);
    if (BOOL_TYPES.has(type)) return new ObjcPrimitiveDecoder(decodable, { bits: 8, signed: false }, true);
    // the raw bits are handed over by the hook manager (see nativeFloatArgs.ts), the native decoder reinterprets them
    if (type in FLOAT_TYPES) return new NativeValueDecoder(decodable, FLOAT_TYPES[type]);
    if (UNSUPPORTED_TYPES.has(type)) return new ObjcUnsupportedDecoder(decodable);
    if (type === "SEL") return new ObjcSelectorDecoder(decodable);
    if (type === "char*") return new ObjcCStringDecoder(decodable);
    if (type === "block" || type.endsWith("**")) return new ObjcPointerDecoder(decodable);
    if (type === "id" || type.startsWith("id<") || type === "Class") return new ObjcReferenceDecoder(decodable);
    if (type.endsWith("*")) {
      // `void*`, `int*` ... are plain pointers, anything else (`NSString*`) is an object
      return C_TYPES.has(type.slice(0, -1)) ? new ObjcPointerDecoder(decodable) : new ObjcReferenceDecoder(decodable);
    }
    return new ObjcUnsupportedDecoder(decodable);
  },
};
