import ObjC from "frida-objc-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

export class ObjcSelectorDecoder extends Decoder<NativePointer> {
  readonly decoderName = "ObjcSelectorDecoder";
  readonly description = "Decodes a `SEL` as its name, e.g. `initWithString:`.";

  decode(value: NativePointer): DecodedValue {
    return { type: this.type, name: this.name, value: value.isNull() ? null : ObjC.selectorAsString(value) };
  }
}
