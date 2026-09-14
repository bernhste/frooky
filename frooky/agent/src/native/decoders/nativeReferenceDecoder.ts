import { Decoder } from "../../shared/decoders/baseDecoder";
import { Decodable } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../shared/frookySettings";
import { logger } from "../../shared/logger";
import { toHexAndAscii } from "../../shared/utils";
import { FridaFundamentalType, FridaReferenceType } from "./nativeFridaType";

type ReferenceDecoder = (input: NativePointer, setting: DecoderSettings, arg?: DecodedValue) => any;

const readWord = (input: NativePointer, signed: boolean): number | string => {
  if (Process.pointerSize < 8) {
    return signed ? input.readS32() : input.readU32();
  }
  return signed ? input.readS64().toString() : input.readU64().toString();
};

// Passing `decodeLimit` as the `size` argument to `readUtf8String()` is unsafe: Frida
// reads up to `size` bytes eagerly rather than stopping at the first NUL, so a short
// string sitting near the end of a small/mapped region can trigger an out-of-bounds
// read. Read the (safely NUL-bounded) string first and only then cap its length in JS.
const truncateToDecodeLimit = (value: string | null, decodeLimit: number): string | null =>
  value !== null && value.length > decodeLimit ? value.slice(0, decodeLimit) : value;

// A length argument is usually declared as `int`/`size_t`/etc. On LP64 targets
// NativeValueDecoder returns size_t/long/ssize_t/ulong/int64/uint64 as decimal
// strings (to preserve full 64-bit precision), so a decoded length arg may
// legitimately be a numeric string rather than a `number` - accept both.
const parseLengthArgValue = (value: unknown): number | undefined => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return undefined;
};

const referenceDecoders: Record<FridaFundamentalType, ReferenceDecoder> = {
  void: (input, setting, arg) => {
    // TODO: should be generalized to be usable by other reference decoders (char *, int8....)
    // for now, we assume, that the first argument is the length of the array as an int
    try {
      if (arg) {
        const length = parseLengthArgValue(arg.value);
        if (length === undefined) {
          throw Error(`void * Decoder: Argument must be a number, but it is: ${arg.value}`);
        }
        logger.debug(`void * Decoder: Decoder argument passed: ${length}`);

        let readLength: number;
        if (length > setting.decodeLimit) {
          logger.debug(`void * Decoder: Setting the argument value of ${length} to the max decode length of ${setting.decodeLimit}.`);
          readLength = setting.decodeLimit;
        } else {
          readLength = length;
        }
        const rawBytes = input.readByteArray(readLength);
        logger.debug(`void * Decoder: Successfully read ${readLength} bytes`);
        if (rawBytes !== null) {
          var bytes = new Uint8Array(rawBytes);
          return toHexAndAscii(bytes);
        }
      }
    } catch (e) {
      logger.warn(`Unable to decode void *: ${e}`);
      return null;
    }
  },
  bool: (input) => input.readU8() !== 0,
  char: (input, setting) => {
    // TODO: May be replaced in the future by a better string decoder
    try {
      return truncateToDecodeLimit(input.readUtf8String(), setting.decodeLimit);
    } catch (e) {
      return input.readS8();
    }
  },
  int8: (input) => input.readS8(),
  uchar: (input, setting, arg) => {
    // TODO: should be generalized to be usable by other reference decoders (char *, int8....)
    // for now, we assume, that the first argument is the length of the array as an int
    try {
      if (arg) {
        const length = parseLengthArgValue(arg.value);
        if (length === undefined) {
          throw Error(`Argument for uchar * decoder must be a number, but it is: ${arg.value}`);
        }
        // logger.debug(`uchar * Decoder: Decoder argument passed: ${JSON.stringify(arg, null, 2)}.`);

        const decodeLength = length > setting.decodeLimit ? setting.decodeLimit : length;
        const rawBytes = input.readByteArray(decodeLength);
        logger.debug(`uchar * Decoder: Successfully read ${decodeLength} bytes of uchar *`);
        if (rawBytes !== null) {
          var bytes = new Uint8Array(rawBytes);
          return toHexAndAscii(bytes);
        }
      } else {
        try {
          return truncateToDecodeLimit(input.readUtf8String(), setting.decodeLimit);
        } catch (e) {
          return input.readS8();
        }
      }
    } catch (e) {
      logger.warn(`Unable to decode uchar *: ${e}`);
      return null;
    }
  },
  uint8: (input) => input.readU8(),
  int16: (input) => input.readS16(),
  uint16: (input) => input.readU16(),
  int: (input) => input.readS32(),
  int32: (input) => input.readS32(),
  // ssize_t/long are signed and pointer/word-sized: 4 bytes on ILP32 targets, 8 bytes on LP64 targets.
  ssize_t: (input) => readWord(input, true),
  long: (input) => readWord(input, true),
  uint: (input) => input.readU32(),
  uint32: (input) => input.readU32(),
  // size_t/ulong are unsigned and pointer/word-sized, same reasoning as above.
  size_t: (input) => readWord(input, false),
  ulong: (input) => readWord(input, false),
  // Returned as decimal strings: a JS number only carries 53 bits of integer
  // precision, which a genuine 64-bit value can exceed.
  int64: (input) => input.readS64().toString(),
  uint64: (input) => input.readU64().toString(),
  float: (input) => input.readFloat(),
  double: (input) => input.readDouble(),
};

export class NativeReferenceDecoder extends Decoder<NativePointer> {
  protected fridaReference: FridaReferenceType;
  protected cachedDecoder: ReferenceDecoder | null = null;

  constructor(decodable: Decodable, fridaReference: FridaReferenceType) {
    super(decodable);
    this.fridaReference = fridaReference;
  }

  public decode(value: NativePointer, arg?: DecodedValue): DecodedValue {
    if (this.cachedDecoder === null) {
      this.cachedDecoder = referenceDecoders[this.fridaReference.pointee];
    }
    return {
      type: this.decodable.type,
      name: this.decodable.name,
      value: this.cachedDecoder(value, this.decodable.settings, arg),
    };
  }
}
