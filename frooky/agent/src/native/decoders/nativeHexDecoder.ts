import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { countArg, DecoderArgValues, logDecodeFailure } from "../../shared/decoders/decoderArgs";
import { toHex } from "../../shared/utils";
import { readUnsignedBits } from "./nativeConstantsDecoder";
import { parseNativeFridaType } from "./nativeFridaType";
import { readBoundedString, readCString } from "./nativeStringDecoder";

// A pointer or array type, e.g. `const uint8_t *`, `SSL *` or `char *[]`
export const isNativePointerType = (type: string): boolean => /\*|\[\s*\]/.test(type);

// The type whose size a number is read with: a `float` or `double` arrives as the IEEE 754 bits of its FP register
const bitsTypeOf = (type: string): string => {
  const fridaType = parseNativeFridaType(type);
  return fridaType === "float" ? "uint32_t" : fridaType === "double" ? "uint64_t" : type;
};

// `decoder: hex`: the bytes a pointer points to as one hex string, e.g. `0x48656c6c6f`, and a number passed by value
// as hex of its bits, e.g. -1 as an `int` is `0xffffffff` and 1.5 as a `float` is `0x3fc00000`. The roles in `args`,
// both in bytes: `offset` skips bytes at the start, `length` is the number of bytes, otherwise they end at a NUL byte.
export class NativeHexDecoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeHexDecoder";
  readonly description = "Decodes the bytes a pointer points to, up to `maxItems` bytes, or a number as hex of its bits.";
  private readonly bitsType = bitsTypeOf(this.type);

  public decode(value: NativePointer, args?: DecoderArgValues): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: isNativePointerType(this.type) ? this.readBytes(value, args) : this.readNumber(value),
    };
  }

  // null for a float argument that isn't in an FP register, e.g. the 9th
  private readNumber(value: NativePointer | null): string | null {
    return value === null ? null : "0x" + readUnsignedBits(value, this.bitsType).toString(16);
  }

  // null for NULL or unreadable memory, or invalid roles
  private readBytes(input: NativePointer, args: DecoderArgValues | undefined): string | null {
    if (input.isNull()) return null;
    try {
      const maxItems = this.settings.maxItems;
      const start = input.add(countArg(args, "offset") ?? 0);
      const length = countArg(args, "length");
      const [bytes, truncated] = length !== undefined ? readBoundedString(start, length, maxItems) : readCString(start, maxItems);
      return toHex(bytes) + (truncated ? "..." : "");
    } catch (e) {
      logDecodeFailure(`Unable to decode ${this.type} as hex`, e);
      return null;
    }
  }
}
