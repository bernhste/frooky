import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { classConstants, decodeConstantValues } from "../utils/decodeConstants";

// Decodes a value to the name of the matching constant, e.g. `1` -> `ENCRYPT_MODE` for `Cipher.init(int, Key)`.
// The constants are `config.constants`, a map or a class, or without it the `static final` fields of the hooked
// class. Falls back to the raw value if no constant matches.
export class ConstantsDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "ConstantsDecoder";
  readonly description =
    "Decodes a value to the name of the matching constant in `config.constants` (a map or a class), or else of the `static final` constants of the hooked class, e.g. `1` to `ENCRYPT_MODE` for `Cipher.init()`.";

  // the constants of the class in `config.constants`, or of the hooked class
  private readonly constantsOfClass = this.resolveClassConstants();

  decode(value: Java.Wrapper): DecodedValue {
    const configConstants = this.settings.config?.constants;
    const name = typeof configConstants === "object" ? this.findInConfig(value, configConstants) : this.findInClass(value);
    return {
      type: this.type,
      name: this.name,
      value: name ?? value,
    };
  }

  private resolveClassConstants() {
    const constants = this.settings.config?.constants;
    const { declaringClass } = this.decodable;
    if (typeof constants === "string") return classConstants(constants, this.type, declaringClass);
    if (constants || !declaringClass) return [];
    return decodeConstantValues(declaringClass, "*", declaringClass);
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

  // Frida passes `int`s as signed numbers, decodeConstantValues() returns them unsigned (`>>> 0`)
  private normalize(value: Java.Wrapper): unknown {
    return this.type === "int" ? Number(value) >>> 0 : value;
  }
}
