import type Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { truncateString } from "../../../shared/utils";

export class PrimitiveDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "PrimitiveDecoder";
  readonly description =
    "Passes Java primitives and strings through as JSON values; `long` becomes a decimal string to keep its 64-bit precision, and a string is cut after `maxItems` characters.";

  decode(value: Java.Wrapper): DecodedValue {
    let decodedValue: any = this.needsUnwrap() && value != null ? value.toString() : value;
    if (this.type === "java.lang.String" && decodedValue != null) {
      decodedValue = truncateString(decodedValue, this.settings.maxItems);
    }
    return {
      type: this.type,
      name: this.name,
      value: decodedValue,
    };
  }

  private needsUnwrap(): boolean {
    return this.type === "long" || this.type === "java.lang.String";
  }
}
