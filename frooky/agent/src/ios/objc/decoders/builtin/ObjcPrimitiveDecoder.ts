import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

export type ObjcIntegerType = { bits: 8 | 16 | 32 | 64; signed: boolean };

/**
 * Decodes integer, char and BOOL values. Objective-C passes them in general-purpose registers,
 * so Frida hands them over as the raw register content in a `NativePointer`.
 */
export class ObjcPrimitiveDecoder extends Decoder<NativePointer> {
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
      decodedValue = number.toString(); // does not fit safely into a JavaScript number
    } else {
      decodedValue = Number(number);
    }
    return { type: this.type, name: this.name, value: decodedValue };
  }
}
