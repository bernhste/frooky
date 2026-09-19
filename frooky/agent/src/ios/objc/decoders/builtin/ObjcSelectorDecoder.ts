import ObjC from "frida-objc-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

/** Decodes a `SEL` as its name. */
export class ObjcSelectorDecoder extends Decoder<NativePointer> {
  decode(value: NativePointer): DecodedValue {
    return { type: this.type, name: this.name, value: value.isNull() ? null : ObjC.selectorAsString(value) };
  }
}
