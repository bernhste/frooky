import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../shared/frookySettings";
import { logger } from "../../shared/logger";
import { bytesToString, trimIncompleteUtf8Tail } from "../../shared/utils";
import { parseLengthArgValue } from "./nativeDecoderArg";

// Reads byte by byte up to the NUL terminator, so it never reads past it into unmapped memory. Reads at most
// `limit` bytes plus one to tell whether the string continues.
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

// Reads `length` bytes, at most `limit`. NUL bytes are data here, e.g. in a buffer from `read`.
function readBoundedString(input: NativePointer, length: number, limit: number): [bytes: Uint8Array, truncated: boolean] {
  const rawBytes = input.readByteArray(Math.min(length, limit));
  const bytes = rawBytes === null ? new Uint8Array(0) : new Uint8Array(rawBytes);
  return [bytes, length > limit];
}

// Decodes a string as UTF-8, else as ASCII, for `char *` and `decoder: string`. Without `arg` the string ends
// at its NUL terminator, with `arg` (the decoded decoderArg) it has that length. At most `maxItems` bytes are
// decoded, a longer string ends with `...`. Returns null for NULL or unreadable memory.
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
    // a cut multi-byte character would make the whole string decode as ASCII
    return truncated ? bytesToString(trimIncompleteUtf8Tail(bytes)) + "..." : bytesToString(bytes);
  } catch (e) {
    logger.warn(`Unable to decode ${type} as a string: ${e}`);
    return null;
  }
}

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
