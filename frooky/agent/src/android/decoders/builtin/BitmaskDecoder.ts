import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { decodeBitmask } from "../../../shared/decoders/constantNames";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { logger } from "../../../shared/logger";
import { configClassConstants } from "../utils/decodeConstants";

const SIGN_BIT_64 = uint64("0x8000000000000000");
const LOW_63_BITS = int64("0x7fffffffffffffff");

// The bits of a Java integer as unsigned, e.g. -1 as an `int` is 0xffffffff. Undefined for other values.
function javaBits(value: unknown, type: string): UInt64 | undefined {
  const n = Number(String(value));
  if (!Number.isInteger(n)) return undefined;
  switch (type) {
    case "byte":
      return uint64(n & 0xff);
    case "short":
    case "char":
      return uint64(n & 0xffff);
    case "long": {
      // a long beyond 2^53 is passed as a string; Int64 keeps all 64 bits
      const long = int64(String(value));
      const low = uint64(long.and(LOW_63_BITS).toString());
      return long.compare(0) < 0 ? low.add(SIGN_BIT_64) : low;
    }
    default:
      return uint64(n >>> 0);
  }
}

// `decoder: bitmask`: the names of the constants whose bits are set in an integer bitmask, e.g.
// `["PURPOSE_ENCRYPT", "PURPOSE_DECRYPT"]` for the purposes of a Keystore key. The constants are the map in
// `config.constants`, or else the `static final` fields of `config.class` or of the hooked class that match
// `config.fields`. Bits no constant matches are added as hex. A value that is no integer is returned as is.
export class BitmaskDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "BitmaskDecoder";
  readonly description =
    "Decodes an integer bitmask to the names of the constants whose bits are set: of `config.constants`, or else of the `static final` constants of `config.class` or of the hooked class.";

  private warned = false;
  private readonly constants = this.resolveConstants();

  decode(value: Java.Wrapper): DecodedValue {
    const constants = this.constants;
    const bits = value == null ? undefined : javaBits(value, this.type);
    if (!constants || bits === undefined) {
      if (!constants && !this.warned) {
        logger.warn(`decoder: bitmask on '${this.name ?? this.type}' needs 'config.constants' or 'config.class', it is decoded as a number.`);
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
    const config = this.settings.config;
    if (config?.constants) return config.constants;
    if (!config?.class && !this.decodable.declaringClass) return undefined;
    const entries = configClassConstants(this.decodable).flatMap(({ name, value }) => {
      const bits = javaBits(value, this.type);
      return name !== undefined && bits !== undefined ? [[name, bits.toNumber()] as const] : [];
    });
    this.warned = entries.length === 0;
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
}
