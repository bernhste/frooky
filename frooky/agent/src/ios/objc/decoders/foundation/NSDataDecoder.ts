import ObjC from "frida-objc-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { toHex } from "../../../../shared/utils";

/**
 * Decodes `NSData` (and subclasses such as `NSMutableData`) as hex string, limited to `decodeLimit` bytes.
 */
export class NSDataDecoder extends Decoder<NativePointer> {
  decode(value: NativePointer): DecodedValue {
    if (value.isNull()) {
      return { type: this.type, name: this.name, value: null };
    }
    const data = new ObjC.Object(value);
    const length = Number(String(data.length()));
    const readLength = Math.min(length, this.settings.decodeLimit);
    const bytes = readLength > 0 ? new Uint8Array((data.bytes() as NativePointer).readByteArray(readLength) as ArrayBuffer) : new Uint8Array(0);
    return {
      type: this.type,
      name: this.name,
      value: toHex(bytes) + (length > readLength ? "..." : ""),
    };
  }
}
