import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { toHexAndAscii } from "../../../shared/utils";

export class StringDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    var decodedValue: any;
    if (this.decodable.type == "[B") {
      const bytes = new Uint8Array(Array.from(value as unknown as ArrayLike<number>));
      const [hex, ascii] = toHexAndAscii(bytes, this.decodable.settings.decodeLimit);
      decodedValue = [ascii, hex];
    } else if (value != null && typeof value.toString === "function") {
      decodedValue = value.toString();
    } else {
      decodedValue = value;
    }

    return {
      type: this.decodable.type,
      name: this.decodable.name,
      value: decodedValue,
    };
  }
}
