import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { readBytesLimited, toHex } from "../../../shared/utils";

export class HexDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    var decodedValue: any;
    if (value == null) {
      decodedValue = value;
    } else if (this.decodable.type == "[B") {
      const [bytes, truncated] = readBytesLimited(value as unknown as ArrayLike<number>, this.decodable.settings.decodeLimit);
      decodedValue = toHex(bytes) + (truncated ? "..." : "");
    } else {
    }
    return {
      type: this.decodable.type,
      name: this.decodable.name,
      value: decodedValue,
    };
  }
}
