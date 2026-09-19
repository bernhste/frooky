import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

/**
 * Placeholder for types which cannot be read from the raw register content yet: structs, unions and arrays passed by value.
 */
export class ObjcUnsupportedDecoder extends Decoder<NativePointer> {
  decode(_value: NativePointer): DecodedValue {
    return { type: this.type, name: this.name, value: `<unsupported type '${this.type}'>` };
  }
}
