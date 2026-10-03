import { Decoder } from "../../shared/decoders/baseDecoder";
import { Decodable } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../shared/frookySettings";
import { toHex } from "../../shared/utils";
import { countArg, DecoderArgValues, logDecodeFailure } from "../../shared/decoders/decoderArgs";
import { FridaFundamentalType, FridaReferenceType } from "./nativeFridaType";
import { decodeNativeString } from "./nativeStringDecoder";

// `length` is the role `length` in bytes, only passed for `void *`, `char *` and `unsigned char *`
type ReferenceDecoder = (input: NativePointer, setting: DecoderSettings, length?: number) => any;

// Up to `maxItems` of `length` bytes as hex, ending with "..." if truncated.
const readHex = (input: NativePointer, length: number, maxItems: number): string | null => {
  const rawBytes = input.readByteArray(Math.min(length, maxItems));
  if (rawBytes === null) return null;
  return toHex(new Uint8Array(rawBytes)) + (length > maxItems ? "..." : "");
};

const referenceDecoders: Record<FridaFundamentalType, ReferenceDecoder> = {
  // the pointee is unknown without a length, so only the address is shown
  void: (input, setting, length) => (length === undefined ? input.toString() : readHex(input, length, setting.maxItems)),
  bool: (input) => input.readU8() !== 0,
  char: (input, setting, length) => decodeNativeString(input, setting, length === undefined ? undefined : { length }, "char *"),
  int8: (input) => input.readS8(),
  uchar: (input, setting, length) =>
    length === undefined ? decodeNativeString(input, setting, undefined, "unsigned char *") : readHex(input, length, setting.maxItems),
  uint8: (input) => input.readU8(),
  int16: (input) => input.readS16(),
  uint16: (input) => input.readU16(),
  int: (input) => input.readS32(),
  int32: (input) => input.readS32(),
  // 64-bit, frooky only supports 64-bit processes
  ssize_t: (input) => input.readS64().toString(),
  long: (input) => input.readS64().toString(),
  uint: (input) => input.readU32(),
  uint32: (input) => input.readU32(),
  size_t: (input) => input.readU64().toString(),
  ulong: (input) => input.readU64().toString(),
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

// For these, the role `length` is the length of a buffer in bytes, not a number of elements
const BUFFER_POINTEES = new Set<FridaFundamentalType>(["void", "char", "uchar"]);

// A `T *` is read as one T, a `T **` follows the pointer and reads the `T *` it points to, and so on. With the
// role `length`, the outermost pointer is an array of that many elements, e.g. `int *` with 3 is [1, 2, 3] and
// `char **` with 2 is ["a", "b"]; for `void *`, `char *` and `unsigned char *` it is a length in bytes instead
// (see referenceDecoders). The role `offset` skips elements (or bytes) first. A NULL pointer on any level is null.
export class NativeReferenceDecoder extends Decoder<NativePointer> {
  readonly decoderName: string = "NativeReferenceDecoder";
  readonly description: string =
    "Decodes a native pointer by reading what it points to as its declared type, e.g. `char *` as a string, `int *` as an int, `char **` by following both pointers, or an array with the roles `length` and `offset` of `decoderArgs`.";

  protected fridaReference: FridaReferenceType;

  constructor(decodable: Decodable, fridaReference: FridaReferenceType) {
    super(decodable);
    this.fridaReference = fridaReference;
  }

  public decode(value: NativePointer, args?: DecoderArgValues): DecodedValue {
    let decoded: unknown;
    try {
      const { depth } = this.fridaReference;
      const offset = countArg(args, "offset") ?? 0;
      const start = value.isNull() ? value : value.add(offset * this.elementSize(depth));
      decoded = this.decodePointer(start, depth, countArg(args, "length"));
    } catch (e) {
      logDecodeFailure(`Unable to decode ${this.type}${this.name ? ` '${this.name}'` : ""} at ${value}`, e);
      decoded = null;
    }
    return {
      type: this.type,
      name: this.name,
      value: decoded,
    };
  }

  // Size in bytes of what a pointer of this depth points to: a pointer for `T **`, else one T
  protected elementSize(depth: number): number {
    return depth > 1 ? Process.pointerSize : POINTEE_SIZES[this.fridaReference.pointee]();
  }

  protected decodePointer(pointer: NativePointer, depth: number, length?: number): unknown {
    if (pointer.isNull()) return null;
    const pointee = this.fridaReference.pointee;
    if (length !== undefined && !(depth === 1 && BUFFER_POINTEES.has(pointee))) {
      return this.decodeArray(pointer, depth, length);
    }
    if (depth > 1) {
      return this.decodePointer(pointer.readPointer(), depth - 1);
    }
    return referenceDecoders[pointee](pointer, this.settings, length);
  }

  // The elements of a pointer to `count` elements, at most `maxItems` of them.
  private decodeArray(pointer: NativePointer, depth: number, count: number): unknown[] {
    const maxItems = this.settings.maxItems;
    const decodeLen = Math.min(count, maxItems);
    const pointee = this.fridaReference.pointee;
    const stride = this.elementSize(depth);

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

// `decoder: nullTerminated`: a `T **` read as an array that ends at a NULL pointer, like `argv` and `envp` of
// execve(2), e.g. `char **` as ["ls", "-l"]. At most `maxItems` elements are decoded.
export class NativeNullTerminatedArrayDecoder extends NativeReferenceDecoder {
  readonly decoderName = "NativeNullTerminatedArrayDecoder";
  readonly description = "Decodes a pointer to pointers, e.g. `char **`, as an array that ends at a NULL pointer, like the `argv` of execve.";

  public decode(value: NativePointer, args?: DecoderArgValues): DecodedValue {
    let decoded: unknown;
    try {
      const { depth } = this.fridaReference;
      const offset = countArg(args, "offset") ?? 0;
      const start = value.isNull() ? value : value.add(offset * this.elementSize(depth));
      decoded = depth < 2 ? this.decodePointer(start, depth) : this.decodeElements(start);
    } catch (e) {
      logDecodeFailure(`Unable to decode ${this.type}${this.name ? ` '${this.name}'` : ""} at ${value}`, e);
      decoded = null;
    }
    return { type: this.type, name: this.name, value: decoded };
  }

  private decodeElements(pointer: NativePointer): unknown[] | null {
    if (pointer.isNull()) return null;
    const maxItems = this.settings.maxItems;
    const items: unknown[] = [];
    for (let i = 0; ; i++) {
      const element = pointer.add(i * Process.pointerSize).readPointer();
      if (element.isNull()) break;
      if (i === maxItems) {
        items.push(`[truncated at ${maxItems}]`);
        break;
      }
      items.push(this.decodePointer(element, this.fridaReference.depth - 1));
    }
    return items;
  }
}
