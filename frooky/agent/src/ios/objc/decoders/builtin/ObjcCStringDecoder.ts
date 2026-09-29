import { decodeNativeString } from "../../../../native/decoders/nativeStringDecoder";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

export class ObjcCStringDecoder extends Decoder<NativePointer> {
  readonly decoderName = "ObjcCStringDecoder";
  readonly description = "Decodes a `char *` as a UTF-8 (else ASCII) string, up to `maxItems` bytes.";

  decode(value: NativePointer): DecodedValue {
    return { type: this.type, name: this.name, value: decodeNativeString(value, this.settings, undefined, this.type) };
  }
}
