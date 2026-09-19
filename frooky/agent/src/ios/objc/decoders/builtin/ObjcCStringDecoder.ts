import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

/** Decodes `char *` as a UTF-8 string, limited to `decodeLimit` bytes. */
export class ObjcCStringDecoder extends Decoder<NativePointer> {
  decode(value: NativePointer): DecodedValue {
    let decodedValue: string | null = null;
    if (!value.isNull()) {
      try {
        decodedValue = value.readUtf8String(this.settings.decodeLimit);
      } catch (e) {
        decodedValue = value.toString();
      }
    }
    return { type: this.type, name: this.name, value: decodedValue };
  }
}
