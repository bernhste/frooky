import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { configClassConstants } from "../utils/decodeConstants";

// Decodes a value to the name of the matching constant, e.g. `1` -> `ENCRYPT_MODE` for `Cipher.init(int, Key)`.
// The constants are the map in `config.constants`, or else the `static final` fields of `config.class` or of the
// hooked class that match `config.fields`. Falls back to the raw value if no constant matches.
export class ConstantsDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "ConstantsDecoder";
  readonly description =
    "Decodes a value to the name of the matching constant in `config.constants`, or else of the `static final` constants of `config.class` or of the hooked class, e.g. `1` to `ENCRYPT_MODE` for `Cipher.init()`.";

  private readonly constantsOfClass = configClassConstants(this.decodable);

  decode(value: Java.Wrapper): DecodedValue {
    const configConstants = this.settings.config?.constants;
    const name = configConstants ? this.findInConfig(value, configConstants) : this.findInClass(value);
    return {
      type: this.type,
      name: this.name,
      value: name ?? value,
    };
  }

  private findInClass(value: Java.Wrapper): string | undefined {
    const normalizedValue = this.normalize(value);
    return this.constantsOfClass.find(({ type, value: constantValue }) => type === this.type && constantValue === normalizedValue)?.name;
  }

  // Compares numbers, so only numeric values match. An `int` is compared as 32 bits, so `0x80000000` and
  // `-2147483648` are the same constant.
  private findInConfig(value: Java.Wrapper, constants: Record<string, number>): string | undefined {
    const n = Number(String(value));
    if (Number.isNaN(n)) return undefined;
    const matches = this.type === "int" ? (c: number) => c >>> 0 === n >>> 0 : (c: number) => c === n;
    return Object.entries(constants).find(([, c]) => matches(c))?.[0];
  }

  // Frida passes `int`s as signed numbers, decodeConstantValues() returns them unsigned (`>>> 0`), and `long`s as
  // decimal strings, as a `long` beyond 2^53 has no exact JS number
  private normalize(value: Java.Wrapper): unknown {
    if (this.type === "int") return Number(value) >>> 0;
    if (this.type === "long") return String(value);
    return value;
  }
}
