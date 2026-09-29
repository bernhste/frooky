import type { RuntimeInstance } from "frida-swift-bridge/dist/lib/types.js";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { bytesToString, trimIncompleteUtf8Tail } from "../../../../shared/utils";

// Layout of `Swift.String` on 64-bit platforms (see stdlib/public/core/StringObject.swift): two words, the top
// nibble of the second one holds the flags: bit 63 immortal, bit 62 ASCII (small) or bridged (large), bit 61
// small, bit 60 foreign.
// - small string: up to 15 UTF-8 bytes inline in both words, the count in bits 56-59 of the second word
// - native large string: the count in the low 48 bits of the first word, the second word holds the address
//   of the storage object, whose UTF-8 code units follow a 32 byte header
// - bridged (NSString) and foreign strings are not decoded
const SMALL_FLAG = 1n << 61n;
const BRIDGED_FLAG = 1n << 62n;
const FOREIGN_FLAG = 1n << 60n;
const ADDRESS_MASK = 0x0fffffffffffffffn;
const COUNT_MASK = 0x0000ffffffffffffn;
const NATIVE_HEADER_SIZE = 32;

export class SwiftStringDecoder extends Decoder<RuntimeInstance> {
  readonly decoderName = "SwiftStringDecoder";
  readonly description = "Decodes a native `Swift.String` as a string, up to `maxItems` bytes. Bridged `NSString`s are not decoded.";

  decode(value: RuntimeInstance): DecodedValue {
    return { type: this.type, name: this.name, value: this.readString(value.handle) };
  }

  private readString(handle: NativePointer): string {
    const countAndFlags = BigInt(handle.readU64().toString());
    const object = BigInt(handle.add(8).readU64().toString());

    if (object & SMALL_FLAG) {
      const count = Number((object >> 56n) & 0xfn);
      const bytes = new Uint8Array(count);
      for (let i = 0; i < count; i++) {
        const word = i < 8 ? countAndFlags : object;
        bytes[i] = Number((word >> BigInt((i % 8) * 8)) & 0xffn);
      }
      return bytesToString(bytes);
    }

    if (object & (BRIDGED_FLAG | FOREIGN_FLAG)) {
      return "<bridged Swift string>";
    }

    const count = Number(countAndFlags & COUNT_MASK);
    const readLength = Math.min(count, this.settings.maxItems);
    const start = ptr((object & ADDRESS_MASK).toString()).add(NATIVE_HEADER_SIZE);
    const raw = readLength > 0 ? start.readByteArray(readLength) : null;
    const bytes = raw === null ? new Uint8Array(0) : new Uint8Array(raw);
    // a cut multi-byte character would make the whole string decode as ASCII
    return count > readLength ? bytesToString(trimIncompleteUtf8Tail(bytes)) + "..." : bytesToString(bytes);
  }
}
