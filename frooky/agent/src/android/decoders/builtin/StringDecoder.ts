import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { isValidUtf8, readBytesLimited, toAscii, toUtf8 } from "../../../shared/utils";

export class StringDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    var decodedValue: any;
    if (value == null) {
      decodedValue = value;
    } else if (this.type == "[B") {
      const [bytes, truncated] = readBytesLimited(value as unknown as ArrayLike<number>, this.settings.decodeLimit);
      const hasMultiByteChars = bytes.some((byte) => byte >= 0x80);
      const decoded = hasMultiByteChars && isValidUtf8(bytes) ? toUtf8(bytes) : toAscii(bytes);
      decodedValue = decoded + (truncated ? "..." : "");
    } else {
      // call the objects .toString()
      const typedValue = Java.cast(value, Java.use(value.$className));
      decodedValue = typedValue.toString();
    }
    return {
      type: this.type,
      name: this.name,
      value: decodedValue,
    };
  }
}
