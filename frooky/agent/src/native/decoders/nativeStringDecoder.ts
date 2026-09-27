import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../shared/frookySettings";
import { logger } from "../../shared/logger";
import { bytesToString, trimIncompleteUtf8Tail } from "../../shared/utils";
import { parseLengthArgValue } from "./nativeDecoderArg";

/**
 * Reads a NUL-terminated string byte by byte, reading at most `limit + 1` bytes so it never runs past
 * the terminator (or far past `limit`) into unmapped memory. The extra byte tells whether the string
 * continues after `limit`.
 */
function readCString(input: NativePointer, limit: number): [bytes: Uint8Array, truncated: boolean] {
  const bytes: number[] = [];
  for (let i = 0; i < limit; i++) {
    const byte = input.add(i).readU8();
    if (byte === 0) {
      return [new Uint8Array(bytes), false];
    }
    bytes.push(byte);
  }
  return [new Uint8Array(bytes), input.add(limit).readU8() !== 0];
}

/**
 * Reads exactly `length` bytes (capped at `limit`). NUL bytes are part of the data, not a terminator: with
 * an explicit length, the buffer may legitimately contain them (e.g. binary data from `read`).
 */
function readBoundedString(input: NativePointer, length: number, limit: number): [bytes: Uint8Array, truncated: boolean] {
  const rawBytes = input.readByteArray(Math.min(length, limit));
  const bytes = rawBytes === null ? new Uint8Array(0) : new Uint8Array(rawBytes);
  return [bytes, length > limit];
}

/**
 * Decodes a pointer to a C string as UTF-8, or as ASCII if it isn't valid UTF-8. All native string
 * decoding goes through this function, both `decoder: string` and the default for `char *`.
 *
 * Without `arg`, the string ends at its NUL terminator. With `arg` (the decoded `decoderArg`), its value
 * is the buffer length and exactly that many bytes are decoded, including any NUL bytes (shown as `.` when
 * decoded as ASCII). Either way, at most `settings.maxItems` bytes are decoded, and a longer
 * string ends with `...`.
 *
 * @param type - The declared type, used in the warning when the string can't be read.
 * @returns The decoded string, or `null` for a NULL pointer or unreadable memory.
 */
export function decodeNativeString(input: NativePointer, settings: DecoderSettings, arg: DecodedValue | undefined, type: string): string | null {
  if (input.isNull()) {
    return null;
  }

  try {
    const maxItems = settings.maxItems;
    let bytes: Uint8Array;
    let truncated: boolean;
    if (arg) {
      const length = parseLengthArgValue(arg.value);
      if (length === undefined || length < 0) {
        throw Error(`decoderArg must be a non-negative number, but it is: ${arg.value}`);
      }
      [bytes, truncated] = readBoundedString(input, length, maxItems);
    } else {
      [bytes, truncated] = readCString(input, maxItems);
    }
    // a limit can cut a multi-byte UTF-8 character in half, which would make the whole string decode as ASCII
    return truncated ? bytesToString(trimIncompleteUtf8Tail(bytes)) + "..." : bytesToString(bytes);
  } catch (e) {
    logger.warn(`Unable to decode ${type} as a string: ${e}`);
    return null;
  }
}

/**
 * Custom decoder selected with `decoder: string`, for pointers whose declared type isn't decoded as a
 * string by default (e.g. `void *`). See {@link decodeNativeString}.
 */
export class NativeStringDecoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeStringDecoder";
  readonly description = "Reads the memory a pointer points to as a string, for pointer types not decoded as strings by default (e.g. `void *`).";

  public decode(value: NativePointer, arg?: DecodedValue): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: decodeNativeString(value, this.settings, arg, this.type),
    };
  }
}
