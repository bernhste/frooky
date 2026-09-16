import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { decodeConstantValues } from "../utils/decodeConstants";

/**
 * Decodes a value to the name of the matching `static final` constant declared on the hooked
 * method's own class (e.g. `1` -> `"ENCRYPT_MODE"` for `javax.crypto.Cipher.init(int, Key)`,
 * since `Cipher.ENCRYPT_MODE == 1`), instead of the raw value. Falls back to the raw value when
 * no declared constant of the same type matches, or the declaring class is unknown.
 *
 * Declared constants never change at runtime, so the per-class reflection lookup happens once via
 * {@link decodeConstantValues}'s own cache and is shared across every decoder instance.
 */
export class ConstantDecoder extends Decoder<Java.Wrapper> {
  private readonly constants = this.decodable.declaringClass ? decodeConstantValues(this.decodable.declaringClass, "") : [];

  decode(value: Java.Wrapper): DecodedValue {
    const normalizedValue = this.normalize(value);
    const constant = this.constants.find(({ type, value: constantValue }) => type === this.type && constantValue === normalizedValue);

    return {
      type: this.type,
      name: this.name,
      value: constant ? constant.name : value,
    };
  }

  // Mirrors decodeConstantValues()'s own `int` handling: Frida delivers Java `int`s as signed JS
  // numbers, while reflection reads them as unsigned (via `>>> 0`) to stay precise for the full
  // 32-bit range, so the same conversion is needed here for the two to compare equal.
  private normalize(value: Java.Wrapper): unknown {
    return this.type === "int" ? Number(value) >>> 0 : value;
  }
}
