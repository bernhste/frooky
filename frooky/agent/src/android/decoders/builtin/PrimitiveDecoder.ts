import type Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";

export class PrimitiveDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "PrimitiveDecoder";
  readonly description = "Passes Java primitives and strings through as JSON values; `long` becomes a decimal string to keep its 64-bit precision.";

  decode(value: Java.Wrapper): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: this.needsUnwrap() && value != null ? value.toString() : value,
    };
  }

  private needsUnwrap(): boolean {
    return this.type === "long" || this.type === "java.lang.String";
  }
}
