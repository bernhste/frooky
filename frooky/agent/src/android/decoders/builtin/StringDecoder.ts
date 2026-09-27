import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { bytesToString, readBytesLimited, trimIncompleteUtf8Tail } from "../../../shared/utils";

export class StringDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "StringDecoder";
  readonly description = "Decodes a value with its Java `toString()`, and a `byte[]` as text (UTF-8 if valid, otherwise ASCII).";

  decode(value: Java.Wrapper): DecodedValue {
    var decodedValue: any;
    if (value == null) {
      decodedValue = value;
    } else if (this.type == "[B") {
      const [bytes, truncated] = readBytesLimited(value as unknown as ArrayLike<number>, this.settings.maxItems);
      decodedValue = truncated ? bytesToString(trimIncompleteUtf8Tail(bytes)) + "..." : bytesToString(bytes);
    } else {
      decodedValue = value.toString();
    }
    return {
      type: this.type,
      name: this.name,
      value: decodedValue,
    };
  }
}
