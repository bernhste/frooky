import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { countArg, DecoderArgValues, logDecodeFailure } from "../../shared/decoders/decoderArgs";
import { logger } from "../../shared/logger";
import { base64ReadLimit, bytesToString, decodeBase64Value } from "../../shared/utils";
import { decodeNativeString, readBoundedString, readCString } from "./nativeStringDecoder";

// Base64-decodes the string a pointer points to. The roles in `args`, both in bytes: `offset` skips bytes at the
// start, `length` is the length of the string, otherwise it ends at its NUL terminator. Text that isn't base64 is
// decoded like `decoder: string`, so the event keeps it.
export class NativeBase64Decoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeBase64Decoder";
  readonly description =
    "Base64-decodes the string a pointer points to, as text if the bytes are printable text, otherwise as hex, up to `maxItems` bytes.";

  private warned = false;

  public decode(value: NativePointer, args?: DecoderArgValues): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: this.decodeBase64(value, args),
    };
  }

  // null for NULL or unreadable memory, or invalid roles
  private decodeBase64(input: NativePointer, args: DecoderArgValues | undefined): string | null {
    if (input.isNull()) {
      return null;
    }

    let encoded: Uint8Array;
    let inputTruncated: boolean;
    try {
      const limit = base64ReadLimit(this.settings.maxItems);
      const start = input.add(countArg(args, "offset") ?? 0);
      const length = countArg(args, "length");
      [encoded, inputTruncated] = length !== undefined ? readBoundedString(start, length, limit) : readCString(start, limit);
    } catch (e) {
      logDecodeFailure(`Unable to decode ${this.type} as base64`, e);
      return null;
    }

    try {
      return decodeBase64Value(bytesToString(encoded), this.settings.maxItems, inputTruncated);
    } catch (e) {
      // once per parameter, a hook can fire very often
      const message = `Decoder 'base64' failed on ${this.type}${this.name ? ` '${this.name}'` : ""}, decoding it as a string: ${e}`;
      if (this.warned) {
        logger.debug(message);
      } else {
        logger.warn(message);
        this.warned = true;
      }
      return decodeNativeString(input, this.settings, args, this.type);
    }
  }
}
