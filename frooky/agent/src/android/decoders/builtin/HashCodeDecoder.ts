import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";

let javaObject: Java.Wrapper | undefined;
function getJavaObject(): Java.Wrapper {
  return (javaObject ??= Java.use("java.lang.Object"));
}

// Decodes an object as `<runtime class>@<hex hashCode()>`, like the default `Object.toString()`, without
// calling an overridden `toString()`. Classes with a content-based `hashCode()` (e.g. Android Keystore keys,
// by alias) get the same value for equal objects. Hash codes can collide.
export class HashCodeDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "HashCodeDecoder";
  readonly description = "Decodes an object as `<class>@<hashCode in hex>` without calling its `toString()`, to tell instances apart.";

  decode(value: Java.Wrapper): DecodedValue {
    let decodedValue: string | null = null;
    if (value != null) {
      const target = typeof value.hashCode === "function" ? value : Java.cast(value, getJavaObject());
      const hash: number = target.hashCode();
      decodedValue = `${value.$className}@${(hash >>> 0).toString(16)}`;
    }
    return {
      type: this.type,
      name: this.name,
      value: decodedValue,
    };
  }
}
