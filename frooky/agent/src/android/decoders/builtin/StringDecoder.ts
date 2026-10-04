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

// The Java `toString()` of a value. Interface wrappers have no Java toString() method dispatcher, falling back to
// Object.prototype.toString, so they are cast to java.lang.Object.
export function javaToString(value: Java.Wrapper): string {
  const target = value.toString === Object.prototype.toString ? Java.cast(value, getJavaObject()) : value;
  return target.toString();
}

export class StringDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "StringDecoder";
  readonly description =
    "Decodes a value with its Java `toString()`, a `byte[]` as text (UTF-8 if valid, otherwise ASCII) and a `char[]` as text, up to `maxItems` characters or bytes.";

  // the roles `offset` and `length` select a slice of a byte[] or char[], e.g. of `new String(bytes, offset, length)`
  decode(value: Java.Wrapper, args?: DecoderArgValues): DecodedValue {
    var decodedValue: any;
    const bounds =
      value != null && (this.type == "[B" || this.type == "[C")
        ? arraySliceBounds(value, args, `${this.type}${this.name ? ` '${this.name}'` : ""}`)
        : undefined;
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
      decodedValue = truncateString(javaToString(value), this.settings.maxItems);
    }
    return {
      type: this.type,
      name: this.name,
      value: decodedValue,
    };
  }
}

// The slice of a byte[] or char[] that the roles select, null if they are invalid. `what` names the value in the
// warning, e.g. `[B 'data'`.
export function arraySliceBounds(value: Java.Wrapper, args: DecoderArgValues | undefined, what: string): { start: number; end: number } | null {
  try {
    return sliceBounds(args, (value as unknown as ArrayLike<unknown>).length);
  } catch (e) {
    logDecodeFailure(`Unable to decode ${what}`, e);
    return null;
  }
}
