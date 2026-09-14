import Java from "frida-java-bridge";
import { Decoder } from "../../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { decodeGetterValues } from "../../../utils/javaDecodeGetterValues";

export class KeyGenParameterSpecDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    return {
      type: this.decodable.type,
      name: this.decodable.name,
      value: decodeGetterValues(value, ["get", "is"], this.decodable.settings),
    };
  }
}
