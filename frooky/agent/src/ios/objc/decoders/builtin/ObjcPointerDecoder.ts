import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

export class ObjcPointerDecoder extends Decoder<NativePointer> {
  readonly decoderName = "ObjcPointerDecoder";
  readonly description = "Decodes a plain pointer (`void *`, `int *`, a block, ...) as its address.";

  decode(value: NativePointer): DecodedValue {
    return { type: this.type, name: this.name, value: value.toString() };
  }
}
