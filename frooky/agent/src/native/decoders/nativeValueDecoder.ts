import { Decoder } from "../../shared/decoders/baseDecoder";
import { Decodable } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { FridaFundamentalType } from "./nativeFridaType";

type FundamentalValueDecoder = (input: NativePointer) => null | number | boolean | string;

const INT64_MAX = "9223372036854775807";

// Interprets 64 raw bits as two's complement. `int64("0x...")` would saturate at INT64_MAX instead.
const decodeSigned64 = (raw: UInt64): string => {
  if (raw.compare(INT64_MAX) <= 0) {
    return raw.toString();
  }
  const magnitude = raw.not().add(1); // -raw, mod 2^64
  return `-${magnitude.toString()}`;
};

// to reinterpret float/double bits
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
  // 64-bit, frooky only supports 64-bit processes
  ssize_t: (input) => decodeSigned64(uint64(input.toString())),
  long: (input) => decodeSigned64(uint64(input.toString())),
  uint: (input) => input.toUInt32(),
  uint32: (input) => input.toUInt32(),
  size_t: (input) => uint64(input.toString()).toString(),
  ulong: (input) => uint64(input.toString()).toString(),
  // 64-bit values are decimal strings, a JS number has only 53 bits of precision
  int64: (input) => decodeSigned64(uint64(input.toString())),
  uint64: (input) => uint64(input.toString()).toString(),
  // `input` holds the raw bits of the float/double, not an address
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
  readonly decoderName = "NativeValueDecoder";
  readonly description = "Decodes a native value passed by value (`int`, `long`, `float`, ...) as its declared type.";

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
