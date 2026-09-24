import type Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";

export class PrimitiveDecoder extends Decoder<Java.Wrapper> {
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
