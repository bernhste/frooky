import { Decoder } from "../../shared/decoders/baseDecoder";
import { Decodable } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { logger } from "../../shared/logger";
import { ConstantSet, decodeConstant, decodeBitmask } from "../../shared/decoders/constantNames";
import { FridaFundamentalType, parseNativeFridaType } from "./nativeFridaType";

const BYTE_SIZES: Partial<Record<FridaFundamentalType, () => number>> = {
  bool: () => 1,
  char: () => 1,
  uchar: () => 1,
  int8: () => 1,
  uint8: () => 1,
  int16: () => 2,
  uint16: () => 2,
  int: () => 4,
  uint: () => 4,
  int32: () => 4,
  uint32: () => 4,
  int64: () => 8,
  uint64: () => 8,
  long: () => Process.pointerSize,
  ulong: () => Process.pointerSize,
  size_t: () => Process.pointerSize,
  ssize_t: () => Process.pointerSize,
};

const INT64_MAX = uint64("0x7fffffffffffffff");
const MAX_SAFE = uint64(Number.MAX_SAFE_INTEGER);

const sizeOf = (type: string): number => {
  const fridaType = parseNativeFridaType(type);
  return typeof fridaType === "string" ? (BYTE_SIZES[fridaType]?.() ?? 4) : 4;
};

// The bits of an integer passed by value, unsigned and cut to the size of its declared type. Types frooky
// doesn't know, such as `mode_t`, are read as 32 bits, the size of a C enum.
function readUnsignedBits(value: NativePointer, type: string): UInt64 {
  const size = sizeOf(type);
  const raw = uint64(value.toString());
  return size === 8 ? raw : raw.and(uint64(2 ** (size * 8) - 1));
}

// A number in the output, or a decimal string if a JSON number can't hold it exactly.
const toJsonNumber = (n: UInt64): number | string => (n.compare(MAX_SAFE) <= 0 ? n.toNumber() : n.toString());

// The value of `bits` as its declared type, e.g. 0xffffffff as an `int` is -1.
function toSignedValue(bits: UInt64, type: string): number | string {
  const fridaType = parseNativeFridaType(type);
  if (typeof fridaType === "string" && /^(uchar|uint|ulong|size_t|bool)/.test(fridaType)) return toJsonNumber(bits);
  const size = sizeOf(type);
  if (size === 8) {
    if (bits.compare(INT64_MAX) <= 0) return toJsonNumber(bits);
    const magnitude = toJsonNumber(bits.not().add(1)); // -bits, mod 2^64
    return typeof magnitude === "number" ? -magnitude : `-${magnitude}`;
  }
  const n = bits.toNumber();
  const signBit = 2 ** (size * 8 - 1);
  return n >= signBit ? n - 2 * signBit : n;
}

// `decoder: constants`: the name of the constant in `config.constants` with the value of an integer.
export class NativeConstantsDecoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeConstantsDecoder";
  readonly description = "Decodes an integer to the name of the constant with that value, from `config.constants` or a preset.";

  private constants: Record<string, number> | undefined;

  // `preset` is a built-in decoder such as `socketDomain`, undefined on a platform it has no values for
  constructor(decodable: Decodable, preset?: ConstantSet | null) {
    super(decodable);
    this.constants = preset === undefined ? decodable.settings.config?.constants : preset?.constants;
    if (!this.constants && preset === undefined) {
      logger.warn(`decoder: constants on '${decodable.name ?? decodable.type}' needs 'config: { constants }', it is decoded as a number.`);
    }
  }

  public decode(value: NativePointer): DecodedValue {
    const signed = toSignedValue(readUnsignedBits(value, this.type), this.type);
    return {
      type: this.type,
      name: this.name,
      value: this.constants ? decodeConstant(signed, this.constants) : signed,
    };
  }
}

// `decoder: bitmask`: the names of the constants in `config.constants` whose bits are set in an integer.
export class NativeBitmaskDecoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeBitmaskDecoder";
  readonly description = "Decodes an integer bitmask to the names of the constants whose bits are set, from `config.constants` or a preset.";

  private constantSet: ConstantSet | undefined;

  constructor(decodable: Decodable, preset?: ConstantSet | null) {
    super(decodable);
    if (preset !== undefined) {
      this.constantSet = preset ?? undefined;
    } else if (decodable.settings.config?.constants) {
      this.constantSet = { constants: decodable.settings.config.constants };
    }
    if (!this.constantSet && preset === undefined) {
      logger.warn(`decoder: bitmask on '${decodable.name ?? decodable.type}' needs 'config: { constants }', it is decoded as a number.`);
    }
  }

  public decode(value: NativePointer): DecodedValue {
    const bits = readUnsignedBits(value, this.type);
    return {
      type: this.type,
      name: this.name,
      value: this.constantSet ? decodeBitmask(bits, this.constantSet) : toJsonNumber(bits),
    };
  }
}
