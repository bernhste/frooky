import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { decodeBitmask } from "../../../shared/decoders/constantNames";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { logger } from "../../../shared/logger";
import { classConstants } from "../utils/decodeConstants";

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

// `decoder: bitmask`: the names of the constants in `config.constants` (a map or a class) whose bits are set in an
// integer bitmask, e.g. `["PURPOSE_ENCRYPT", "PURPOSE_DECRYPT"]` for the purposes of a Keystore key. Bits no constant
// matches are added as hex. A value that is no integer is returned as is.
export class BitmaskDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "BitmaskDecoder";
  readonly description = "Decodes an integer bitmask to the names of the constants in `config.constants` (a map or a class) whose bits are set.";

  private warned = false;
  private readonly constants = this.resolveConstants();

  decode(value: Java.Wrapper): DecodedValue {
    const constants = this.constants;
    const bits = value == null ? undefined : javaBits(value, this.type);
    if (!constants || bits === undefined) {
      if (!constants && !this.warned) {
        logger.warn(`decoder: bitmask on '${this.name ?? this.type}' needs 'config: { constants }', it is decoded as a number.`);
        this.warned = true;
      }
      return { type: this.type, name: this.name, value };
    }
    return { type: this.type, name: this.name, value: decodeBitmask(bits, { constants }) };
  }

  // The constants of a class as numbers of their unsigned bits, e.g. -1 as an `int` is 0xffffffff. A `long` above
  // 2^53 keeps its bits only if it is a power of two, e.g. `1L << 62`. Undefined if the class has none, which
  // classConstants() has warned about.
  private resolveConstants(): Record<string, number> | undefined {
    const constants = this.settings.config?.constants;
    if (typeof constants !== "string") return constants;
    const entries = classConstants(constants, this.type, this.decodable.declaringClass).flatMap(({ name, value }) => {
      const bits = javaBits(value, this.type);
      return name !== undefined && bits !== undefined ? [[name, bits.toNumber()] as const] : [];
    });
    this.warned = entries.length === 0;
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
}
