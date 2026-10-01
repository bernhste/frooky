import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { countArg, DecoderArgValues, logDecodeFailure } from "../../shared/decoders/decoderArgs";
import { DecoderSettings } from "../../shared/frookySettings";

// Code unit types that are UTF-16 by definition: C11/C++ `char16_t`, JNI `jchar`, Foundation `unichar`,
// CoreFoundation `UniChar` and ICU `UChar`. Case-sensitive, since `uchar` is `unsigned char`. `wchar_t` is UTF-32
// on Android and iOS, so it's not here.
const UTF16_UNIT_TYPES = new Set(["char16_t", "jchar", "unichar", "UniChar", "UChar"]);

// e.g. `const jchar *` or `char16_t*`
export function isUtf16PointerType(type: string): boolean {
  const match = type
    .replace(/\b(const|volatile)\b/g, "")
    .trim()
    .match(/^(\w+)\s*\*$/);
  return match !== null && UTF16_UNIT_TYPES.has(match[1]);
}

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;

// Reads UTF-16LE code units: `length` of them, or up to a 0 unit. At most `maxItems` units plus one to tell whether
// the string continues. Unreadable memory ends the string.
function readUnits(input: NativePointer, maxItems: number, length: number | undefined): [units: number[], truncated: boolean] {
  const units: number[] = [];
  const limit = length === undefined ? maxItems + 1 : Math.min(length, maxItems);
  for (let i = 0; i < limit; i++) {
    let unit: number;
    try {
      unit = input.add(i * 2).readU16();
    } catch (_) {
      break;
    }
    if (length === undefined && unit === 0) break;
    units.push(unit);
  }
  if (length !== undefined) return [units, length > maxItems];
  const truncated = units.length > maxItems;
  return [truncated ? units.slice(0, maxItems) : units, truncated];
}

// A UTF-16 string as text. The roles in `args`, both in code units (2 bytes each): `offset` skips units at the start,
// `length` is the length of the string, otherwise it ends at a 0 unit. At most `maxItems` units are decoded, a longer
// string ends with `...`. Null for NULL.
export function decodeUtf16String(input: NativePointer, settings: DecoderSettings, args: DecoderArgValues | undefined): string | null {
  if (input.isNull()) return null;
  const start = input.add((countArg(args, "offset") ?? 0) * 2);
  const [units, truncated] = readUnits(start, settings.maxItems, countArg(args, "length"));
  // a cut surrogate pair would leave half a character
  if (truncated && units.length > 0 && isHighSurrogate(units[units.length - 1])) units.pop();
  let text = "";
  for (let i = 0; i < units.length; i += 4096) {
    text += String.fromCharCode(...units.slice(i, i + 4096));
  }
  return truncated ? text + "..." : text;
}

// Pointers to `char16_t`, `jchar`, `unichar`, `UniChar` and `UChar`, and `decoder: utf16` on any pointer
export class NativeUtf16Decoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeUtf16Decoder";
  readonly description =
    "Decodes a UTF-16 string, e.g. a `const jchar *` of JNI or a `UniChar *` of CoreFoundation, up to a 0 code unit or with the roles `length` and `offset` in code units.";

  public decode(value: NativePointer, args?: DecoderArgValues): DecodedValue {
    let decoded: string | null;
    try {
      decoded = decodeUtf16String(value, this.settings, args);
    } catch (e) {
      logDecodeFailure(`Unable to decode ${this.type}${this.name ? ` '${this.name}'` : ""} as UTF-16`, e);
      decoded = null;
    }
    return { type: this.type, name: this.name, value: decoded };
  }
}
