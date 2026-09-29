import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

export class ObjcUnsupportedDecoder extends Decoder<NativePointer> {
  readonly decoderName = "ObjcUnsupportedDecoder";
  readonly description = "Placeholder for structs, unions and arrays passed by value, which cannot be read from a register.";

  decode(_value: NativePointer): DecodedValue {
    return { type: this.type, name: this.name, value: `<unsupported type '${this.type}'>` };
  }
}
