import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";

export class NativeFallbackDecoder extends Decoder<NativePointer> {
  public decode(value: NativePointer): DecodedValue {
    return {
      declaredType: this.decodable.type,
      name: this.decodable.name,
      value: value.toString(),
    };
  }
}
