import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";

export class NativeFallbackDecoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeFallbackDecoder";
  readonly description = "Used for native types frooky does not know: outputs the raw value as a hex number.";

  public decode(value: NativePointer): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: value.toString(),
    };
  }
}
