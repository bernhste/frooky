import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DecoderArgValues } from "../../../shared/decoders/decoderArgs";
import { base64ReadLimit, bytesToString, decodeBase64Value, readBytesLimited } from "../../../shared/utils";
import { decodePrimitiveArray } from "./ArrayDecoder";
import { arraySliceBounds, javaToString } from "./StringDecoder";

// Throws for invalid base64, so OverrideDecoder decodes the value with the default decoder of its type instead
export class Base64Decoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "Base64Decoder";
  readonly description =
    "Base64-decodes a `String`, a `byte[]` or `char[]`, or the `toString()` of a value, as text if the bytes are printable text, otherwise as hex, up to `maxItems` bytes.";

  // the roles `offset` and `length` select a slice of a byte[] or char[]
  decode(value: Java.Wrapper, args?: DecoderArgValues): DecodedValue {
    let decodedValue: string | null = null;
    const bounds =
      value != null && (this.type == "[B" || this.type == "[C")
        ? arraySliceBounds(value, args, `${this.type}${this.name ? ` '${this.name}'` : ""}`)
        : undefined;
    if (value != null && bounds !== null) {
      const [encoded, inputTruncated] = this.readEncoded(value, bounds, base64ReadLimit(this.settings.maxItems));
      decodedValue = decodeBase64Value(encoded, this.settings.maxItems, inputTruncated);
    }
    return {
      type: this.type,
      name: this.name,
      value: decodedValue,
    };
  }

  // At most `limit` characters of the base64 text, and whether the value continues
  private readEncoded(value: Java.Wrapper, bounds: { start: number; end: number } | undefined, limit: number): [string, boolean] {
    if (this.type == "[B") {
      const { start, end } = bounds!;
      const [bytes, truncated] = readBytesLimited(value as unknown as ArrayLike<number>, limit, start, end);
      return [bytesToString(bytes), truncated];
    }
    if (this.type == "[C") {
      const { start, end } = bounds!;
      const decodeLen = Math.min(end - start, limit);
      return [decodePrimitiveArray(value, "[C", decodeLen, start).join(""), end - start > decodeLen];
    }
    const text = javaToString(value);
    return [text.slice(0, limit), text.length > limit];
  }
}
