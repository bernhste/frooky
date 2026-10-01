import { Decoder } from "../../shared/decoders/baseDecoder";
import { Decodable } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { logger } from "../../shared/logger";
import { FridaFundamentalType, parseNativeFridaType } from "./nativeFridaType";

// Constant names and values. A preset can also have an enum field inside the flags, e.g. the access mode
// `O_RDONLY`/`O_WRONLY`/`O_RDWR` in the lowest two bits of the `open` flags.
export type ConstantSet = {
  constants: Record<string, number>;
  enumMask?: number;
  enumConstants?: Record<string, number>;
};

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

// UInt64 has no toString(2), so the bits are counted per hex digit
const popcount = (n: UInt64): number =>
  Array.from(n.toString(16)).reduce((count, digit) => count + parseInt(digit, 16).toString(2).replace(/0/g, "").length, 0);

// The name of the constant with exactly this value, or the value itself if there is none.
export function decodeEnum(value: number | string, constants: Record<string, number>): string | number {
  for (const [name, constant] of Object.entries(constants)) {
    if (typeof value === "number" ? constant === value : String(constant) === value) return name;
  }
  return value;
}

// The names of the constants whose bits are all set, e.g. `["O_WRONLY", "O_CREAT"]`. Constants with more bits
// are matched first and use up their bits, so `O_SYNC` (which includes `O_DSYNC`) isn't also shown as `O_DSYNC`.
// Bits no constant matches are added as one hex string. A constant of 0 is only shown if no bit is set.
export function decodeFlags(bits: UInt64, set: ConstantSet): string[] {
  const names: string[] = [];
  let remaining = bits;
  if (set.enumMask !== undefined && set.enumConstants) {
    const mask = uint64(set.enumMask);
    const field = bits.and(mask).toNumber();
    const name = Object.entries(set.enumConstants).find(([, v]) => v === field)?.[0];
    if (name !== undefined) {
      names.push(name);
      remaining = remaining.and(mask.not());
    }
  }

  const candidates = Object.entries(set.constants)
    .filter(([, v]) => v > 0)
    .map(([name, v]) => ({ name, bits: uint64(v) }))
    .sort((a, b) => popcount(b.bits) - popcount(a.bits));
  const matched = new Set<string>();
  for (const { name, bits: flag } of candidates) {
    if (remaining.and(flag).equals(flag)) {
      matched.add(name);
      remaining = remaining.and(flag.not());
    }
  }
  // in the order the constants are declared, not the order they were matched in
  names.push(...Object.keys(set.constants).filter((name) => matched.has(name)));

  if (!remaining.equals(uint64(0))) {
    names.push(`0x${remaining.toString(16)}`);
  } else if (names.length === 0) {
    const zeroName = Object.entries(set.constants).find(([, v]) => v === 0)?.[0];
    if (zeroName !== undefined) names.push(zeroName);
  }
  return names;
}

// `decoder: enum`: the name of the constant in `constants` with the value of an integer.
export class NativeEnumDecoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeEnumDecoder";
  readonly description = "Decodes an integer to the name of the constant with that value, from `constants` or a preset.";

  private constants: Record<string, number> | undefined;

  // `preset` is a built-in decoder such as `socketDomain`, undefined on a platform it has no values for
  constructor(decodable: Decodable, preset?: ConstantSet | null) {
    super(decodable);
    this.constants = preset === undefined ? decodable.settings.constants : preset?.constants;
    if (!this.constants && preset === undefined) {
      logger.warn(`decoder: enum on '${decodable.name ?? decodable.type}' needs 'constants', it is decoded as a number.`);
    }
  }

  public decode(value: NativePointer): DecodedValue {
    const signed = toSignedValue(readUnsignedBits(value, this.type), this.type);
    return {
      type: this.type,
      name: this.name,
      value: this.constants ? decodeEnum(signed, this.constants) : signed,
    };
  }
}

// `decoder: flags`: the names of the constants in `constants` whose bits are set in an integer.
export class NativeFlagsDecoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeFlagsDecoder";
  readonly description = "Decodes an integer bitmask to the names of the constants whose bits are set, from `constants` or a preset.";

  private constantSet: ConstantSet | undefined;

  constructor(decodable: Decodable, preset?: ConstantSet | null) {
    super(decodable);
    if (preset !== undefined) {
      this.constantSet = preset ?? undefined;
    } else if (decodable.settings.constants) {
      this.constantSet = { constants: decodable.settings.constants };
    }
    if (!this.constantSet && preset === undefined) {
      logger.warn(`decoder: flags on '${decodable.name ?? decodable.type}' needs 'constants', it is decoded as a number.`);
    }
  }

  public decode(value: NativePointer): DecodedValue {
    const bits = readUnsignedBits(value, this.type);
    return {
      type: this.type,
      name: this.name,
      value: this.constantSet ? decodeFlags(bits, this.constantSet) : toJsonNumber(bits),
    };
  }
}
