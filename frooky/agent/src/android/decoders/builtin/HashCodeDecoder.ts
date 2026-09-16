import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";

/**
 * Decodes any reference type as `<runtime class name>@<hex hashCode()>` - the same shape Java's
 * default `Object.toString()` produces (`getClass().getName() + "@" + Integer.toHexString(hashCode())`)
 * - but computed directly from `hashCode()` instead of calling `toString()`, so a class that
 * overrides `toString()` to print something else (e.g. a key's full modulus) never gets invoked.
 *
 * `hashCode()` itself is still called normally, so if a class overrides it to be based on stable
 * content (as Android Keystore's key classes do, keyed by alias rather than object identity),
 * that stability carries through here too - two separate `KeyStore.getKey()` calls for the same
 * alias return different Java objects but the same hashCode(), letting this decoder answer "is
 * this the same key" rather than "is this the same object reference". hashCode() offers no
 * uniqueness guarantee (it can collide, and isn't always reference-based) - it's just whatever the
 * runtime class actually returns.
 */
export class HashCodeDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    let decodedValue: string | null = null;
    if (value != null) {
      const typedValue = Java.cast(value, Java.use(value.$className));
      const hash: number = typedValue.hashCode();
      decodedValue = `${value.$className}@${(hash >>> 0).toString(16)}`;
    }
    return {
      type: this.decodable.type,
      name: this.decodable.name,
      value: decodedValue,
    };
  }
}
