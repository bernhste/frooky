import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { decodeFlags } from "../../../shared/decoders/constantNames";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { logger } from "../../../shared/logger";

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

// `decoder: flags`: the names of the constants in `constants` whose bits are set in an integer bitmask, e.g.
// `["PURPOSE_ENCRYPT", "PURPOSE_DECRYPT"]` for the purposes of a Keystore key. Bits no constant matches are added as
// hex. A value that is no integer is returned as is.
export class FlagsDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "FlagsDecoder";
  readonly description = "Decodes an integer bitmask to the names of the constants in `constants` whose bits are set.";

  private warned = false;

  decode(value: Java.Wrapper): DecodedValue {
    const constants = this.settings.constants;
    const bits = value == null ? undefined : javaBits(value, this.type);
    if (!constants || bits === undefined) {
      if (!constants && !this.warned) {
        logger.warn(`decoder: flags on '${this.name ?? this.type}' needs 'constants', it is decoded as a number.`);
        this.warned = true;
      }
      return { type: this.type, name: this.name, value };
    }
    return { type: this.type, name: this.name, value: decodeFlags(bits, { constants }) };
  }
}
