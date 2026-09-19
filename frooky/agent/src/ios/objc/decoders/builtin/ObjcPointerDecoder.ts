import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

/** Decodes plain pointers (`void *`, blocks, ...) as their address. */
export class ObjcPointerDecoder extends Decoder<NativePointer> {
  decode(value: NativePointer): DecodedValue {
    return { type: this.type, name: this.name, value: value.toString() };
  }
}
