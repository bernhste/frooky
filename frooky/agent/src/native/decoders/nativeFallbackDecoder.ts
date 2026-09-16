import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";

export class NativeFallbackDecoder extends Decoder<NativePointer> {
  public decode(value: NativePointer): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: value.toString(),
    };
  }
}
