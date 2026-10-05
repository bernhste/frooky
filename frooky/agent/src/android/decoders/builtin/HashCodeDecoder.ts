import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { javaIdentityHashCode } from "../utils/javaValues";

// Decodes an object as `<runtime class>@<hex System.identityHashCode()>`, without calling its `toString()` or
// `hashCode()`. The hash code is the `hashCode` of the events about the same object, e.g. a hooked method that
// returns `this`. Hash codes can collide.
export class HashCodeDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "HashCodeDecoder";
  readonly description = "Decodes an object as `<class>@<identity hash code in hex>`, the `hashCode` of the events about it.";

  decode(value: Java.Wrapper): DecodedValue {
    let decodedValue: string | null = null;
    if (value != null) {
      // primitives and strings, which Frida passes as JS values, have no identity; OverrideDecoder decodes them as they are
      if (typeof value !== "object") throw new Error(`${typeof value} has no identity hash code`);
      decodedValue = `${value.$className}@${javaIdentityHashCode(value)}`;
    }
    return {
      type: this.type,
      name: this.name,
      value: decodedValue,
    };
  }
}
