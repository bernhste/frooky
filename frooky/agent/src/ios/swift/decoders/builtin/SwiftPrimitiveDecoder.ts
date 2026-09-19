import type { RuntimeInstance } from "frida-swift-bridge/dist/lib/types.js";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

type PrimitiveReader = (handle: NativePointer) => number | boolean | string;

// 64 bit integers are returned as decimal strings: a JS number only carries 53 bits of integer precision
export const SWIFT_PRIMITIVE_READERS: Record<string, PrimitiveReader> = {
  "Swift.Int": (p) => p.readS64().toString(),
  "Swift.Int64": (p) => p.readS64().toString(),
  "Swift.UInt": (p) => p.readU64().toString(),
  "Swift.UInt64": (p) => p.readU64().toString(),
  "Swift.Int32": (p) => p.readS32(),
  "Swift.UInt32": (p) => p.readU32(),
  "Swift.Int16": (p) => p.readS16(),
  "Swift.UInt16": (p) => p.readU16(),
  "Swift.Int8": (p) => p.readS8(),
  "Swift.UInt8": (p) => p.readU8(),
  "Swift.Bool": (p) => p.readU8() !== 0,
  "Swift.Float": (p) => p.readFloat(),
  "Swift.Double": (p) => p.readDouble(),
};

/**
 * Decodes the Swift standard library's integer, floating point and boolean structs.
 * The bridge hands them over as a struct value whose handle points to their raw bytes.
 */
export class SwiftPrimitiveDecoder extends Decoder<RuntimeInstance> {
  decode(value: RuntimeInstance): DecodedValue {
    return { type: this.type, name: this.name, value: SWIFT_PRIMITIVE_READERS[this.type](value.handle) };
  }
}
