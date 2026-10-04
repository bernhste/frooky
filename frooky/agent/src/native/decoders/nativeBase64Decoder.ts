import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { countArg, DecoderArgValues, logDecodeFailure } from "../../shared/decoders/decoderArgs";
import { DecoderSettings } from "../../shared/frookySettings";
import { base64ToBytes, bytesToString, trimIncompleteUtf8Tail } from "../../shared/utils";
import { readBoundedString, readCString } from "./nativeStringDecoder";

// Reads the memory a pointer points to as a string, then Base64-decodes it as text or bytes.
// The roles in `args`, both in bytes: `offset` skips bytes at the start, `length` is the length of the string,
// otherwise it ends at its NUL terminator. At most `maxItems` decoded bytes are returned, a longer decoded
// string ends with `...`. Returns null for NULL or unreadable memory or invalid base64.
export function decodeNativeBase64(input: NativePointer, settings: DecoderSettings, args: DecoderArgValues | undefined, type: string): string | null {
  if (input.isNull()) {
    return null;
  }

  try {
    const start = input.add(countArg(args, "offset") ?? 0);
    const length = countArg(args, "length");
    const [rawBytes] = length !== undefined ? readBoundedString(start, length, length) : readCString(start, Infinity);
    const rawStr = bytesToString(rawBytes);
    const decodedBytes = base64ToBytes(rawStr);
    const maxItems = settings.maxItems;
    const truncated = decodedBytes.length > maxItems;
    const resultBytes = truncated ? trimIncompleteUtf8Tail(decodedBytes.subarray(0, maxItems)) : decodedBytes;
    return truncated ? bytesToString(resultBytes) + "..." : bytesToString(resultBytes);
  } catch (e) {
    logDecodeFailure(`Unable to decode ${type} as base64`, e);
    return null;
  }
}

export class NativeBase64Decoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeBase64Decoder";
  readonly description = "Reads the memory a pointer points to as a string, then Base64-decodes it as text or bytes up to `maxItems` bytes.";

  public decode(value: NativePointer, args?: DecoderArgValues): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: decodeNativeBase64(value, this.settings, args, this.type),
    };
  }
}
