import ObjC from "frida-objc-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { toHex } from "../../../../shared/utils";

export class NSDataDecoder extends Decoder<NativePointer> {
  readonly decoderName = "NSDataDecoder";
  readonly description = "Decodes an `NSData` (or a subclass such as `NSMutableData`) as a hex string, up to `maxItems` bytes.";

  decode(value: NativePointer): DecodedValue {
    if (value.isNull()) {
      return { type: this.type, name: this.name, value: null };
    }
    const data = new ObjC.Object(value);
    const length = Number(String(data.length()));
    const readLength = Math.min(length, this.settings.maxItems);
    const raw = readLength > 0 ? (data.bytes() as NativePointer).readByteArray(readLength) : null;
    const bytes = raw === null ? new Uint8Array(0) : new Uint8Array(raw);
    return {
      type: this.type,
      name: this.name,
      value: toHex(bytes) + (length > readLength ? "..." : ""),
    };
  }
}
