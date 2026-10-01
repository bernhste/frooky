import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { decodeConstantValues } from "../utils/decodeConstants";

// Decodes a value to the name of the matching constant, e.g. `1` -> `ENCRYPT_MODE` for `Cipher.init(int, Key)`.
// The constants are the `constants` of the decoder settings or, without them, the static fields of the hooked
// class. Falls back to the raw value if no constant matches.
export class ConstantDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "ConstantDecoder";
  readonly description =
    "Decodes a value to the name of the matching constant in `constants`, or else of the `static final` constants of the hooked class, e.g. `1` to `ENCRYPT_MODE` for `Cipher.init()`.";

  private readonly constants = this.settings.constants
    ? []
    : this.decodable.declaringClass
      ? decodeConstantValues(this.decodable.declaringClass, "")
      : [];

  decode(value: Java.Wrapper): DecodedValue {
    const name = this.settings.constants ? this.findInSettings(value, this.settings.constants) : this.findInClass(value);
    return {
      type: this.type,
      name: this.name,
      value: name ?? value,
    };
  }

  private findInClass(value: Java.Wrapper): string | undefined {
    const normalizedValue = this.normalize(value);
    return this.constants.find(({ type, value: constantValue }) => type === this.type && constantValue === normalizedValue)?.name;
  }

  // Compares numbers, so only numeric values match. An `int` is compared as 32 bits, so `0x80000000` and
  // `-2147483648` are the same constant.
  private findInSettings(value: Java.Wrapper, constants: Record<string, number>): string | undefined {
    const n = Number(String(value));
    if (Number.isNaN(n)) return undefined;
    const matches = this.type === "int" ? (c: number) => c >>> 0 === n >>> 0 : (c: number) => c === n;
    return Object.entries(constants).find(([, c]) => matches(c))?.[0];
  }

  // Frida passes `int`s as signed numbers, decodeConstantValues() returns them unsigned (`>>> 0`)
  private normalize(value: Java.Wrapper): unknown {
    return this.type === "int" ? Number(value) >>> 0 : value;
  }
}
