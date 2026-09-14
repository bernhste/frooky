import { Decoder } from "../../shared/decoders/baseDecoder";
import { Decodable } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { FridaFundamentalType } from "./nativeFridaType";

type FundamentalValueDecoder = (input: NativePointer) => null | number | boolean | string;

const decodeWord = (input: NativePointer, signed: boolean): number | string => {
  if (Process.pointerSize < 8) {
    return signed ? input.toInt32() : input.toUInt32();
  }
  return signed ? int64(input.toString()).toString() : uint64(input.toString()).toString();
};

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
  int64: (input) => int64(input.toString()).toString(),
  uint64: (input) => uint64(input.toString()).toString(),
  // `input` holds the raw integer bit pattern of the float/double, not a memory
  // address, so it's written to scratch memory and read back as the FP type to
  // get a correct IEEE-754 reinterpretation instead of a numeric truncation.
  float: (input) => {
    const scratch = Memory.alloc(4);
    scratch.writeU32(input.toUInt32());
    return scratch.readFloat();
  },
  double: (input) => {
    const scratch = Memory.alloc(8);
    scratch.writeU64(uint64(input.toString()));
    return scratch.readDouble();
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
      type: this.decodable.type,
      name: this.decodable.name,
      value: this.cachedValueDecoder(value),
    };
  }
}
