import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { decodeBitmask } from "../../../shared/decoders/constantNames";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { logger } from "../../../shared/logger";
import { configClassConstants } from "../utils/decodeConstants";
import { javaBits } from "../utils/javaBits";
import { assertPrimitiveValue } from "./ConstantsDecoder";

// `decoder: bitmask`: the names of the constants whose bits are set in an integer bitmask, e.g.
// `["PURPOSE_ENCRYPT", "PURPOSE_DECRYPT"]` for the purposes of a Keystore key. The constants are the map in
// `decoderOptions.constants`, or else the `static final` fields of `decoderOptions.class` or of the hooked class that match
// `decoderOptions.fields`. Bits no constant matches are added as hex. A primitive that is no integer is returned as is.
// Throws for a value that is no primitive, so OverrideDecoder decodes it with the default decoder of its type.
export class BitmaskDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "BitmaskDecoder";
  readonly description =
    "Decodes an integer bitmask to the names of the constants whose bits are set: of `decoderOptions.constants`, or else of the `static final` constants of `decoderOptions.class` or of the hooked class.";

  private warned = false;
  private readonly constants = this.resolveConstants();

  decode(value: Java.Wrapper): DecodedValue {
    assertPrimitiveValue(value, this.type);
    const constants = this.constants;
    const bits = value == null ? undefined : javaBits(value, this.type);
    if (!constants || bits === undefined) {
      if (!constants && !this.warned) {
        logger.warn(
          `decoder: bitmask on '${this.name ?? this.type}' needs 'decoderOptions.constants' or 'decoderOptions.class', it is decoded as a number.`,
        );
        this.warned = true;
      }
      return { type: this.type, name: this.name, value };
    }
    return { type: this.type, name: this.name, value: decodeBitmask(bits, { constants }) };
  }

  // The map, or the constants of a class as numbers of their unsigned bits, e.g. -1 as an `int` is 0xffffffff. A `long`
  // above 2^53 keeps its bits only if it is a power of two, e.g. `1L << 62`. Undefined without constants; for a class,
  // configClassConstants() has warned about that.
  private resolveConstants(): Record<string, number> | undefined {
    const options = this.settings.decoderOptions;
    if (options?.constants) return options.constants;
    if (!options?.class && !this.decodable.declaringClass) return undefined;
    const entries = configClassConstants(this.decodable).flatMap(({ name, value }) => {
      const bits = javaBits(value, this.type);
      return name !== undefined && bits !== undefined ? [[name, bits.toNumber()] as const] : [];
    });
    this.warned = entries.length === 0;
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
}
