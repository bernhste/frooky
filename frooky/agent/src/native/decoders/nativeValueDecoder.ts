import { Decoder } from "../../shared/decoders/baseDecoder";
import { Decodable } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { FridaFundamentalType } from "./nativeFridaType";

type FundamentalValueDecoder = (input: NativePointer) => null | number | boolean | string;

// Threshold above which a 64-bit magnitude represents a negative value in two's complement.
const INT64_MAX = "9223372036854775807";

// `int64(input.toString())` parses NativePointer#toString()'s "0x..." hex output as a magnitude,
// not a raw bit pattern - for a value whose top bit is set (i.e. negative once reinterpreted as
// signed), that magnitude exceeds what a signed 64-bit value can hold, and it saturates to
// Int64.MAX instead of wrapping around to the correct negative value. Parsing as UInt64 (whose
// full 64-bit range never overflows) and converting to two's complement manually avoids that.
const decodeSigned64 = (raw: UInt64): string => {
  if (raw.compare(INT64_MAX) <= 0) {
    return raw.toString();
  }
  const magnitude = raw.not().add(1); // -raw, mod 2^64
  return `-${magnitude.toString()}`;
};

const decodeWord = (input: NativePointer, signed: boolean): number | string => {
  if (Process.pointerSize < 8) {
    return signed ? input.toInt32() : input.toUInt32();
  }
  const raw = uint64(input.toString());
  return signed ? decodeSigned64(raw) : raw.toString();
};

// Reused by every float/double decode
const floatScratch = Memory.alloc(8);

const valueDecoders: Record<FridaFundamentalType, FundamentalValueDecoder> = {
  void: () => null,
  bool: (input) => input.toInt32() !== 0,
  char: (input) => {
    const r = input.toInt32() & 0xff;
    return r & 0x80 ? r - 0x100 : r;
  },
  int8: (input) => {
    const r = input.toInt32() & 0xff;
    return r & 0x80 ? r - 0x100 : r;
  },
  uchar: (input) => input.toInt32() & 0xff,
  uint8: (input) => input.toInt32() & 0xff,
  int16: (input) => {
    const r = input.toInt32() & 0xffff;
    return r & 0x8000 ? r - 0x10000 : r;
  },
  uint16: (input) => input.toInt32() & 0xffff,
  int: (input) => input.toInt32(),
  int32: (input) => input.toInt32(),
  // ssize_t/long are signed and pointer/word-sized: 32-bit on ILP32 targets, 64-bit on LP64 targets.
  ssize_t: (input) => decodeWord(input, true),
  long: (input) => decodeWord(input, true),
  uint: (input) => input.toUInt32(),
  uint32: (input) => input.toUInt32(),
  // size_t/ulong are unsigned and pointer/word-sized, same reasoning as above.
  size_t: (input) => decodeWord(input, false),
  ulong: (input) => decodeWord(input, false),
  // Returned as decimal strings: a JS number only carries 53 bits of integer
  // precision, which a genuine 64-bit value can exceed.
  int64: (input) => decodeSigned64(uint64(input.toString())),
  uint64: (input) => uint64(input.toString()).toString(),
  // `input` holds the raw integer bit pattern of the float/double, not a memory
  // address, so it's written to scratch memory and read back as the FP type to
  // get a correct IEEE-754 reinterpretation instead of a numeric truncation.
  float: (input) => {
    floatScratch.writeU32(input.toUInt32());
    return floatScratch.readFloat();
  },
  double: (input) => {
    floatScratch.writeU64(uint64(input.toString()));
    return floatScratch.readDouble();
  },
};

export class NativeValueDecoder extends Decoder<NativePointer> {
  protected fridaType: FridaFundamentalType;
  cachedValueDecoder: FundamentalValueDecoder | null = null;

  constructor(decodable: Decodable, fridaType: FridaFundamentalType) {
    super(decodable);
    this.fridaType = fridaType;
  }

  public decode(value: NativePointer): DecodedValue {
    if (!this.cachedValueDecoder) {
      this.cachedValueDecoder = valueDecoders[this.fridaType];
    }
    return {
      type: this.type,
      name: this.name,
      value: this.cachedValueDecoder(value),
    };
  }
}
