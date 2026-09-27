import { Decoder } from "../../shared/decoders/baseDecoder";
import { Decodable } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../shared/frookySettings";
import { logger } from "../../shared/logger";
import { toHex } from "../../shared/utils";
import { parseLengthArgValue } from "./nativeDecoderArg";
import { FridaFundamentalType, FridaReferenceType } from "./nativeFridaType";
import { decodeNativeString } from "./nativeStringDecoder";

type ReferenceDecoder = (input: NativePointer, setting: DecoderSettings, arg?: DecodedValue) => any;

const readWord = (input: NativePointer, signed: boolean): number | string => {
  if (Process.pointerSize < 8) {
    return signed ? input.readS32() : input.readU32();
  }
  return signed ? input.readS64().toString() : input.readU64().toString();
};

// Reads a buffer of `length` bytes, at most `maxItems` of them, as a hex string. A buffer longer than
// `maxItems` ends with "...".
const readHex = (input: NativePointer, length: number, maxItems: number): string | null => {
  const rawBytes = input.readByteArray(Math.min(length, maxItems));
  if (rawBytes === null) return null;
  return toHex(new Uint8Array(rawBytes)) + (length > maxItems ? "..." : "");
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
        return readHex(input, length, setting.maxItems);
      }
    } catch (e) {
      logger.warn(`Unable to decode void *: ${e}`);
      return null;
    }
  },
  bool: (input) => input.readU8() !== 0,
  char: (input, setting, arg) => decodeNativeString(input, setting, arg, "char *"),
  int8: (input) => input.readS8(),
  uchar: (input, setting, arg) => {
    try {
      if (arg) {
        const length = parseLengthArgValue(arg.value);
        if (length === undefined) {
          throw Error(`Argument for uchar * decoder must be a number, but it is: ${arg.value}`);
        }
        return readHex(input, length, setting.maxItems);
      } else {
        return decodeNativeString(input, setting, undefined, "unsigned char *");
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
  readonly decoderName = "NativeReferenceDecoder";
  readonly description =
    "Decodes a native pointer by reading what it points to as its declared type, e.g. `char *` as a string or `int *` as an int.";

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
      type: this.type,
      name: this.name,
      value: this.cachedDecoder(value, this.settings, arg),
    };
  }
}
