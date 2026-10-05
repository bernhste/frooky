import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DecoderArgValues } from "../../../shared/decoders/decoderArgs";
import { readBytesLimited, toHex } from "../../../shared/utils";
import { javaBits, javaFloatBits } from "../utils/javaBits";
import { decodePrimitiveArray } from "./ArrayDecoder";
import { arraySliceBounds } from "./StringDecoder";

const NUMBER_TYPES = new Set(["byte", "short", "char", "int", "long", "float", "double"]);
const NUMBER_ARRAY_ELEMENTS: Record<string, string> = { "[S": "short", "[C": "char", "[I": "int", "[J": "long", "[F": "float", "[D": "double" };

// The bits of a primitive number: an integer at the size of its type, a `float` or `double` as IEEE 754
const numberBits = (value: unknown, type: string): UInt64 | undefined =>
  type === "float" || type === "double" ? javaFloatBits(value, type) : javaBits(value, type);

// `decoder: hex`: a `byte[]` as one hex string, e.g. `0x48656c6c6f`, a primitive number as hex of its bits, e.g. -1 as
// an `int` is `0xffffffff` and 1.5 as a `float` is `0x3fc00000`, and an array of other numbers as a list of them in
// hex. Throws for any other value, so OverrideDecoder decodes it with the default decoder of its type.
export class HexDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "HexDecoder";
  readonly description =
    "Decodes a `byte[]` as a hex string, up to `maxItems` bytes, a number as hex of its bits, and an array of other numbers as a list of them in hex.";

  // the roles `offset` and `length` select a slice of an array
  decode(value: Java.Wrapper, args?: DecoderArgValues): DecodedValue {
    return { type: this.type, name: this.name, value: value == null ? null : this.toHex(value, args) };
  }

  private toHex(value: Java.Wrapper, args: DecoderArgValues | undefined): string | unknown[] | null {
    if (NUMBER_TYPES.has(this.type)) {
      const bits = numberBits(value, this.type);
      if (bits === undefined) throw new Error(`${value} is no ${this.type}`);
      return "0x" + bits.toString(16);
    }
    const elementType = NUMBER_ARRAY_ELEMENTS[this.type];
    if (this.type !== "[B" && !elementType) throw new Error(`${this.type} is no number or array of numbers`);

    const bounds = arraySliceBounds(value, args, `${this.type}${this.name ? ` '${this.name}'` : ""}`);
    if (bounds === null) return null;
    const { start, end } = bounds;
    const maxItems = this.settings.maxItems;
    if (this.type === "[B") {
      const [bytes, truncated] = readBytesLimited(value as unknown as ArrayLike<number>, maxItems, start, end);
      return toHex(bytes) + (truncated ? "..." : "");
    }
    const decodeLen = Math.min(end - start, maxItems);
    const elements: unknown[] = decodePrimitiveArray(value, elementType, decodeLen, start).map(
      (element) => "0x" + numberBits(element, elementType)!.toString(16),
    );
    if (end - start > decodeLen) elements.push(`[truncated at ${maxItems}]`);
    return elements;
  }
}
