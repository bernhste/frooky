import ObjC from "frida-objc-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

/**
 * Decodes any object using its `-description`. For `NSString` that is the string itself.
 * Used for every object without a dedicated decoder.
 */
export class ObjcStringDecoder extends Decoder<NativePointer> {
  decode(value: NativePointer): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: value.isNull() ? null : new ObjC.Object(value).toString(),
    };
  }
}
