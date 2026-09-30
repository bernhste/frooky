import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { bytesToString, readBytesLimited, trimIncompleteUtf8Tail, truncateString } from "../../../shared/utils";

let javaObject: Java.Wrapper | undefined;
function getJavaObject(): Java.Wrapper {
  return (javaObject ??= Java.use("java.lang.Object"));
}

export class StringDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "StringDecoder";
  readonly description =
    "Decodes a value with its Java `toString()`, and a `byte[]` as text (UTF-8 if valid, otherwise ASCII), up to `maxItems` characters or bytes.";

  decode(value: Java.Wrapper): DecodedValue {
    var decodedValue: any;
    if (value == null) {
      decodedValue = value;
    } else if (this.type == "[B") {
      const [bytes, truncated] = readBytesLimited(value as unknown as ArrayLike<number>, this.settings.maxItems);
      decodedValue = truncated ? bytesToString(trimIncompleteUtf8Tail(bytes)) + "..." : bytesToString(bytes);
    } else {
      // Interface wrappers have no Java toString() method dispatcher, falling back to Object.prototype.toString
      const target = value.toString === Object.prototype.toString ? Java.cast(value, getJavaObject()) : value;
      decodedValue = truncateString(target.toString(), this.settings.maxItems);
    }
    return {
      type: this.type,
      name: this.name,
      value: decodedValue,
    };
  }
}
