import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { decodeConstantValues } from "../utils/decodeConstants";

// Decodes a value to the name of the matching constant of the hooked class, e.g. `1` -> `ENCRYPT_MODE` for
// `Cipher.init(int, Key)`. Falls back to the raw value if no constant of the same type matches.
export class ConstantDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "ConstantDecoder";
  readonly description =
    "Decodes a value to the name of the matching `static final` constant of the hooked class, e.g. `1` to `ENCRYPT_MODE` for `Cipher.init()`.";

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

  // Frida passes `int`s as signed numbers, decodeConstantValues() returns them unsigned (`>>> 0`)
  private normalize(value: Java.Wrapper): unknown {
    return this.type === "int" ? Number(value) >>> 0 : value;
  }
}
