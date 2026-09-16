import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { isValidUtf8, toAscii, toUtf8 } from "../../../shared/utils";

export class StringDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    var decodedValue: any;
    if (value == null) {
      decodedValue = value;
    } else if (this.decodable.type == "[B") {
      const bytes = new Uint8Array(Array.from(value as unknown as ArrayLike<number>));
      const hasMultiByteChars = bytes.some((byte) => byte >= 0x80);
      decodedValue =
        hasMultiByteChars && isValidUtf8(bytes)
          ? toUtf8(bytes, this.decodable.settings.decodeLimit)
          : toAscii(bytes, this.decodable.settings.decodeLimit);
    } else {
      // call the objects .toString()
      const typedValue = Java.cast(value, Java.use(value.$className));
      decodedValue = typedValue.toString();
    }
    return {
      type: this.decodable.type,
      name: this.decodable.name,
      value: decodedValue,
    };
  }
}
