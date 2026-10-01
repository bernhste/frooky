import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { decodePrimitiveArray } from "./ArrayDecoder";
import { DecoderArgValues, logDecodeFailure, sliceBounds } from "../../../shared/decoders/decoderArgs";
import { bytesToString, readBytesLimited, trimIncompleteUtf8Tail, truncateString } from "../../../shared/utils";

let javaObject: Java.Wrapper | undefined;
function getJavaObject(): Java.Wrapper {
  return (javaObject ??= Java.use("java.lang.Object"));
}

export class StringDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "StringDecoder";
  readonly description =
    "Decodes a value with its Java `toString()`, a `byte[]` as text (UTF-8 if valid, otherwise ASCII) and a `char[]` as text, up to `maxItems` characters or bytes.";

  // the roles `offset` and `length` select a slice of a byte[] or char[], e.g. of `new String(bytes, offset, length)`
  decode(value: Java.Wrapper, args?: DecoderArgValues): DecodedValue {
    var decodedValue: any;
    const bounds = value != null && (this.type == "[B" || this.type == "[C") ? this.sliceBounds(value, args) : undefined;
    if (value == null) {
      decodedValue = value;
    } else if (bounds === null) {
      decodedValue = null;
    } else if (this.type == "[B") {
      const { start, end } = bounds!;
      const [bytes, truncated] = readBytesLimited(value as unknown as ArrayLike<number>, this.settings.maxItems, start, end);
      decodedValue = truncated ? bytesToString(trimIncompleteUtf8Tail(bytes)) + "..." : bytesToString(bytes);
    } else if (this.type == "[C") {
      // e.g. a password, which APIs such as PBEKeySpec take as char[] rather than String
      const chars = value as unknown as ArrayLike<string>;
      const { start, end } = bounds!;
      const decodeLen = Math.min(end - start, this.settings.maxItems);
      decodedValue = decodePrimitiveArray(chars, "[C", decodeLen, start).join("") + (end - start > decodeLen ? "..." : "");
    } else {
      // Interface wrappers have no Java toString() method dispatcher, falling back to Object.prototype.toString
      const target = value.toString === Object.prototype.toString ? Java.cast(value, getJavaObject()) : value;
      decodedValue = truncateString(target.toString(), this.settings.maxItems);
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
