import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DecoderArgValues, logDecodeFailure, sliceBounds } from "../../../shared/decoders/decoderArgs";
import { base64ToBytes, bytesToString, readBytesLimited, trimIncompleteUtf8Tail } from "../../../shared/utils";
import { decodePrimitiveArray } from "./ArrayDecoder";

let javaObject: Java.Wrapper | undefined;
function getJavaObject(): Java.Wrapper {
  return (javaObject ??= Java.use("java.lang.Object"));
}

export class Base64Decoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "Base64Decoder";
  readonly description = "Decodes a value to string, then Base64-decodes it as text or bytes up to `maxItems` bytes.";

  // the roles `offset` and `length` select a slice of a byte[] or char[]
  decode(value: Java.Wrapper, args?: DecoderArgValues): DecodedValue {
    let decodedValue: string | null = null;
    const bounds = value != null && (this.type == "[B" || this.type == "[C") ? this.sliceBounds(value, args) : undefined;
    if (value == null) {
      decodedValue = null;
    } else if (bounds === null) {
      decodedValue = null;
    } else {
      let rawStr: string;
      if (this.type == "[B") {
        const { start, end } = bounds!;
        const [bytes] = readBytesLimited(value as unknown as ArrayLike<number>, Infinity, start, end);
        rawStr = bytesToString(bytes);
      } else if (this.type == "[C") {
        const chars = value as unknown as ArrayLike<string>;
        const { start, end } = bounds!;
        rawStr = decodePrimitiveArray(chars, "[C", end - start, start).join("");
      } else if (typeof value === "string") {
        rawStr = value;
      } else {
        const target = value.toString === Object.prototype.toString ? Java.cast(value, getJavaObject()) : value;
        rawStr = target.toString();
      }

      const decodedBytes = base64ToBytes(rawStr);
      const truncated = decodedBytes.length > this.settings.maxItems;
      const resultBytes = truncated ? trimIncompleteUtf8Tail(decodedBytes.subarray(0, this.settings.maxItems)) : decodedBytes;
      decodedValue = truncated ? bytesToString(resultBytes) + "..." : bytesToString(resultBytes);
    }

    return {
      type: this.type,
      name: this.name,
      value: decodedValue,
    };
  }

  // The slice of a byte[] or char[], null if the roles are invalid
  private sliceBounds(value: Java.Wrapper, args?: DecoderArgValues): { start: number; end: number } | null {
    try {
      return sliceBounds(args, (value as unknown as ArrayLike<unknown>).length);
    } catch (e) {
      logDecodeFailure(`Unable to decode ${this.type}${this.name ? ` '${this.name}'` : ""}`, e);
      return null;
    }
  }
}
