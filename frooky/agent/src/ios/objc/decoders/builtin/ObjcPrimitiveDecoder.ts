import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

export type ObjcIntegerType = { bits: 8 | 16 | 32 | 64; signed: boolean };

// Integers, chars and BOOLs are passed in general-purpose registers, so the value is the raw register content.
export class ObjcPrimitiveDecoder extends Decoder<NativePointer> {
  readonly decoderName = "ObjcPrimitiveDecoder";
  readonly description = "Decodes integer, `char` and `BOOL` values; 64-bit integers become decimal strings to keep their precision.";

  constructor(
    decodable: ConstructorParameters<typeof Decoder>[0],
    private readonly integerType: ObjcIntegerType,
    private readonly isBool: boolean = false,
  ) {
    super(decodable);
  }

  decode(value: NativePointer): DecodedValue {
    const { bits, signed } = this.integerType;
    // the upper bits of a register are undefined for types narrower than 64 bits, so mask them first
    const raw = BigInt.asUintN(bits, BigInt(value.toString()));
    const number = signed ? BigInt.asIntN(bits, raw) : raw;

    let decodedValue: boolean | number | string;
    if (this.isBool) {
      decodedValue = number !== 0n;
    } else if (bits === 64) {
      // a JS number has only 53 bits of precision
      decodedValue = number.toString();
    } else {
      decodedValue = Number(number);
    }
    return { type: this.type, name: this.name, value: decodedValue };
  }
}
