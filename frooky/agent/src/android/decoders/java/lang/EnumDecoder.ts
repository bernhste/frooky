import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { useJavaClass } from "../../utils/javaValues";

// name() is the constant as declared in the source. toString() returns the same unless the enum overrides it,
// e.g. to return a display text.
export class EnumDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "EnumDecoder";
  readonly description = "Decodes an enum constant as its declared name (`name()`), even if the enum overrides `toString()`.";

  decode(value: Java.Wrapper): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: value == null ? null : Java.cast(value, useJavaClass("java.lang.Enum")).name(),
    };
  }
}
