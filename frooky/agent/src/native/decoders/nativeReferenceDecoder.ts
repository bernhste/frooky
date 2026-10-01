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

// Up to `maxItems` of `length` bytes as hex, ending with "..." if truncated.
const readHex = (input: NativePointer, length: number, maxItems: number): string | null => {
  const rawBytes = input.readByteArray(Math.min(length, maxItems));
  if (rawBytes === null) return null;
  return toHex(new Uint8Array(rawBytes)) + (length > maxItems ? "..." : "");
};

const referenceDecoders: Record<FridaFundamentalType, ReferenceDecoder> = {
  void: (input, setting, arg) => {
    // the pointee is unknown without a decoderArg (the buffer length), so only the address is shown
    if (!arg) return input.toString();
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
  // pointer-sized: 4 bytes on 32-bit, 8 bytes on 64-bit targets
  ssize_t: (input) => readWord(input, true),
  long: (input) => readWord(input, true),
  uint: (input) => input.readU32(),
  uint32: (input) => input.readU32(),
  size_t: (input) => readWord(input, false),
  ulong: (input) => readWord(input, false),
  // 64-bit values are decimal strings, a JS number has only 53 bits of precision
  int64: (input) => input.readS64().toString(),
  uint64: (input) => input.readU64().toString(),
  float: (input) => input.readFloat(),
  double: (input) => input.readDouble(),
};

// Size in bytes of one element of a `T *` array, e.g. 4 for `int *`.
const POINTEE_SIZES: Record<FridaFundamentalType, () => number> = {
  void: () => 1,
  bool: () => 1,
  char: () => 1,
  uchar: () => 1,
  int8: () => 1,
  uint8: () => 1,
  int16: () => 2,
  uint16: () => 2,
  int: () => 4,
  int32: () => 4,
  uint: () => 4,
  uint32: () => 4,
  float: () => 4,
  long: () => Process.pointerSize,
  ulong: () => Process.pointerSize,
  size_t: () => Process.pointerSize,
  ssize_t: () => Process.pointerSize,
  int64: () => 8,
  uint64: () => 8,
  double: () => 8,
};

// For these, a decoderArg is the length of a buffer in bytes, not a number of elements
const BUFFER_POINTEES = new Set<FridaFundamentalType>(["void", "char", "uchar"]);

// A `T *` is read as one T, a `T **` follows the pointer and reads the `T *` it points to, and so on. With a
// decoderArg, the outermost pointer is an array of that many elements, e.g. `int *` with 3 is [1, 2, 3] and
// `char **` with 2 is ["a", "b"]. For `void *`, `char *` and `unsigned char *` the decoderArg is a buffer
// length instead (see referenceDecoders). A NULL pointer on any level is null.
export class NativeReferenceDecoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeReferenceDecoder";
  readonly description =
    "Decodes a native pointer by reading what it points to as its declared type, e.g. `char *` as a string, `int *` as an int, `char **` by following both pointers, or an array with the number of elements from `decoderArg`.";

  protected fridaReference: FridaReferenceType;

  constructor(decodable: Decodable, fridaReference: FridaReferenceType) {
    super(decodable);
    this.fridaReference = fridaReference;
  }

  public decode(value: NativePointer, arg?: DecodedValue): DecodedValue {
    let decoded: unknown;
    try {
      decoded = this.decodePointer(value, this.fridaReference.depth, arg);
    } catch (e) {
      logger.warn(`Unable to decode ${this.type}${this.name ? ` '${this.name}'` : ""} at ${value}: ${e}`);
      decoded = null;
    }
    return {
      type: this.type,
      name: this.name,
      value: decoded,
    };
  }

  private decodePointer(pointer: NativePointer, depth: number, arg?: DecodedValue): unknown {
    if (pointer.isNull()) return null;
    const pointee = this.fridaReference.pointee;
    if (arg && !(depth === 1 && BUFFER_POINTEES.has(pointee))) {
      return this.decodeArray(pointer, depth, arg);
    }
    if (depth > 1) {
      return this.decodePointer(pointer.readPointer(), depth - 1);
    }
    return referenceDecoders[pointee](pointer, this.settings, arg);
  }

  // The elements of a pointer to `count` elements, at most `maxItems` of them.
  private decodeArray(pointer: NativePointer, depth: number, arg: DecodedValue): unknown[] {
    const count = parseLengthArgValue(arg.value);
    if (count === undefined || count < 0) {
      throw Error(`decoderArg must be a non-negative number of elements, but it is: ${arg.value}`);
    }
    const maxItems = this.settings.maxItems;
    const decodeLen = Math.min(count, maxItems);
    const pointee = this.fridaReference.pointee;
    const stride = depth > 1 ? Process.pointerSize : POINTEE_SIZES[pointee]();

    const items: unknown[] = new Array(decodeLen);
    for (let i = 0; i < decodeLen; i++) {
      const element = pointer.add(i * stride);
      items[i] = depth > 1 ? this.decodePointer(element.readPointer(), depth - 1) : referenceDecoders[pointee](element, this.settings);
    }
    if (count > decodeLen) {
      items.push(`[truncated at ${maxItems}]`);
    }
    return items;
  }
}
