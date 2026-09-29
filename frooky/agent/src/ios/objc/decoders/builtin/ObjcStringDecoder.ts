import ObjC from "frida-objc-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

// Also the fallback for objects without a dedicated decoder, see ObjcReferenceDecoder.
export class ObjcStringDecoder extends Decoder<NativePointer> {
  readonly decoderName = "ObjcStringDecoder";
  readonly description = "Decodes an object as its `-description`, which for an `NSString` is the string itself.";

  decode(value: NativePointer): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: value.isNull() ? null : new ObjC.Object(value).toString(),
    };
  }
}
