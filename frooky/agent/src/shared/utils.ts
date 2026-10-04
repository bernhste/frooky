export class FilterMismatchError extends Error {
  static readonly INSTANCE = new FilterMismatchError();
}

// `*` matches exactly one dot-separated segment, e.g. `org.owasp.*.HttpClient` matches
// `org.owasp.net.HttpClient` but not `org.owasp.net.http.HttpClient`.
export function wildcardPatternToRegExp(pattern: string): RegExp {
  const segments = pattern.split("*").map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${segments.join("[^.]+")}$`);
}

// For method and symbol names: `*` matches any characters, also none, e.g. `get*Key` matches `getKey` and
// `getPublicKey`.
export function namePatternToRegExp(pattern: string): RegExp {
  const segments = pattern.split("*").map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${segments.join(".*")}$`);
}

// JSON.stringify() with sorted object keys, so equal values give the same string
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.keys(val)
            .sort()
            .map((k) => [k, val[k]]),
        )
      : val,
  );
}

const HEX_TABLE: readonly string[] = Object.freeze(Array.from({ length: 256 }, (_, i) => (i < 16 ? "0" : "") + i.toString(16)));

export function uuidv4(): string {
  const r0 = (Math.random() * 0x100000000) >>> 0;
  const r1 = (Math.random() * 0x100000000) >>> 0;
  const r2 = (Math.random() * 0x100000000) >>> 0;
  const r3 = (Math.random() * 0x100000000) >>> 0;

  return (
    HEX_TABLE[r0 & 0xff] +
    HEX_TABLE[(r0 >>> 8) & 0xff] +
    HEX_TABLE[(r0 >>> 16) & 0xff] +
    HEX_TABLE[(r0 >>> 24) & 0xff] +
    "-" +
    HEX_TABLE[r1 & 0xff] +
    HEX_TABLE[(r1 >>> 8) & 0xff] +
    "-" +
    HEX_TABLE[((r1 >>> 16) & 0x0f) | 0x40] + // RFC 4122 version 4
    HEX_TABLE[(r1 >>> 24) & 0xff] +
    "-" +
    HEX_TABLE[(r2 & 0x3f) | 0x80] + // RFC 4122 variant 1
    HEX_TABLE[(r2 >>> 8) & 0xff] +
    "-" +
    HEX_TABLE[(r2 >>> 16) & 0xff] +
    HEX_TABLE[(r2 >>> 24) & 0xff] +
    HEX_TABLE[r3 & 0xff] +
    HEX_TABLE[(r3 >>> 8) & 0xff] +
    HEX_TABLE[(r3 >>> 16) & 0xff] +
    HEX_TABLE[(r3 >>> 24) & 0xff]
  );
}

// [lengthToDecode, "..." if truncated else ""]
function getDecodeBounds(availableLength: number, length: number): [number, string] {
  if (length < 0) {
    throw new RangeError("Length cannot be negative");
  }

  if (availableLength > length) {
    return [length, "..."];
  }
  return [availableLength, ""];
}

// Reads only up to `limit` elements, e.g. of a Java array proxy where every access calls into Java.
// The bytes `[start, end)` of a Java byte[] or array, at most `limit` of them.
export function readBytesLimited(
  array: ArrayLike<number>,
  limit: number,
  start: number = 0,
  end: number = array.length,
): [bytes: Uint8Array, truncated: boolean] {
  const total = Math.max(end - start, 0);
  const readLength = Math.min(total, limit);

  if (readLength === 0) {
    return [new Uint8Array(0), total > limit];
  }

  if (typeof (array as any).withElements === "function") {
    const bytes = (array as any).withElements((elements: NativePointer) => {
      const raw = elements.add(start).readByteArray(readLength);
      return raw !== null ? new Uint8Array(raw) : new Uint8Array(0);
    });
    return [bytes, total > limit];
  }

  const bytes = new Uint8Array(readLength);
  for (let i = 0; i < readLength; i++) {
    bytes[i] = array[start + i];
  }

  return [bytes, total > limit];
}

// printable ASCII, tab, newline or carriage return
function isPrintable(byte: number): boolean {
  return (byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13;
}

// e.g. "0x22aa3482ef..." when truncated to `length` bytes
export function toHex(bytes: Uint8Array, length: number = Infinity): string {
  const [lengthToDecode, ellipsis] = getDecodeBounds(bytes.length, length);
  const hexArray = new Array(lengthToDecode);

  for (let i = 0; i < lengthToDecode; i++) {
    const byte = bytes[i];
    hexArray[i] = HEX_TABLE[byte];
  }

  return "0x" + hexArray.join("") + ellipsis;
}

// Non-printable bytes become `placeholder`, e.g. ".qsf._fHello.!.a..." (ending with "..." when truncated).
export function toAscii(bytes: Uint8Array, length: number = Infinity, placeholder: string = "."): string {
  const [lengthToDecode, ellipsis] = getDecodeBounds(bytes.length, length);
  const asciiArray = new Array(lengthToDecode);

  for (let i = 0; i < lengthToDecode; i++) {
    const byte = bytes[i];
    asciiArray[i] = isPrintable(byte) ? String.fromCharCode(byte) : placeholder;
  }

  return asciiArray.join("") + ellipsis;
}

function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const byte1 = bytes[i];
    let extraBytes: number;
    let codePoint: number;
    let minCodePoint: number;

    if (byte1 <= 0x7f) {
      i += 1;
      continue;
    } else if ((byte1 & 0xe0) === 0xc0) {
      extraBytes = 1;
      codePoint = byte1 & 0x1f;
      minCodePoint = 0x80;
    } else if ((byte1 & 0xf0) === 0xe0) {
      extraBytes = 2;
      codePoint = byte1 & 0x0f;
      minCodePoint = 0x800;
    } else if ((byte1 & 0xf8) === 0xf0) {
      extraBytes = 3;
      codePoint = byte1 & 0x07;
      minCodePoint = 0x10000;
    } else {
      return false;
    }

    if (i + extraBytes >= bytes.length) {
      return false;
    }

    for (let j = 1; j <= extraBytes; j++) {
      const continuationByte = bytes[i + j];
      if ((continuationByte & 0xc0) !== 0x80) {
        return false;
      }
      codePoint = (codePoint << 6) | (continuationByte & 0x3f);
    }

    // overlong encodings and UTF-16 surrogate halves are invalid
    if (codePoint < minCodePoint || (codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > 0x10ffff) {
      return false;
    }

    i += extraBytes + 1;
  }
  return true;
}

// `bytes` must be valid UTF-8 (isValidUtf8()). `length` counts characters.
export function toUtf8(bytes: Uint8Array, length: number = Infinity): string {
  const codePoints: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const byte1 = bytes[i];
    if (byte1 <= 0x7f) {
      codePoints.push(byte1);
      i += 1;
    } else if ((byte1 & 0xe0) === 0xc0) {
      codePoints.push(((byte1 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if ((byte1 & 0xf0) === 0xe0) {
      codePoints.push(((byte1 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else {
      codePoints.push(((byte1 & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f));
      i += 4;
    }
  }

  const [lengthToDecode, ellipsis] = getDecodeBounds(codePoints.length, length);
  return String.fromCodePoint(...codePoints.slice(0, lengthToDecode)) + ellipsis;
}

// Removes a multi-byte character cut off at the end, e.g. by a read limit.
export function trimIncompleteUtf8Tail(bytes: Uint8Array): Uint8Array {
  // walk back over at most 3 continuation bytes (10xxxxxx) to the lead byte of the last character
  for (let i = bytes.length - 1; i >= Math.max(0, bytes.length - 4); i--) {
    const byte = bytes[i];
    if ((byte & 0xc0) === 0x80) continue;
    const sequenceLength = byte < 0x80 ? 1 : (byte & 0xe0) === 0xc0 ? 2 : (byte & 0xf0) === 0xe0 ? 3 : (byte & 0xf8) === 0xf0 ? 4 : 1;
    return i + sequenceLength > bytes.length ? bytes.subarray(0, i) : bytes;
  }
  return bytes;
}

// A 32-bit hash code as unsigned hex, like Java's `Integer.toHexString()`, e.g. `-1` -> `ffffffff`
export function formatHashCode(hashCode: number): string {
  return (hashCode >>> 0).toString(16);
}

// The first `limit` UTF-16 code units of `text`, ending with "..." if cut off. A surrogate pair (e.g. an emoji)
// cut in half at the end is dropped.
export function truncateString(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let end = limit;
  const lastCode = text.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) end--;
  return text.slice(0, end) + "...";
}

// UTF-8 if valid, else ASCII with "." for non-printable bytes
export function bytesToString(bytes: Uint8Array): string {
  const hasMultiByteChars = bytes.some((byte) => byte >= 0x80);
  return hasMultiByteChars && isValidUtf8(bytes) ? toUtf8(bytes) : toAscii(bytes);
}

export function sleepMilliseconds(milliSeconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliSeconds));
}

export function sleepSeconds(seconds: number): Promise<void> {
  return sleepMilliseconds(seconds * 1000);
}

// JSON preview for log messages, cut at `maxLength` characters. Falls back to String() for cycles or BigInt.
export function previewValue(value: unknown, maxLength: number = 200): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}... (${text.length} chars)` : text;
}

// e.g. `1 hook`, `2 hooks`
export function plural(count: number, noun: string, pluralNoun: string = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}

const BASE64_LOOKUP = new Int8Array(128).fill(-1);
"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split("").forEach((c, i) => (BASE64_LOOKUP[c.charCodeAt(0)] = i));
BASE64_LOOKUP[0x2b] = BASE64_LOOKUP[0x2d] = 62; // `+`, URL-safe `-`
BASE64_LOOKUP[0x2f] = BASE64_LOOKUP[0x5f] = 63; // `/`, URL-safe `_`

// Decodes standard (RFC 4648 §4) or URL-safe (§5) base64, padded or not. Whitespace, e.g. the line breaks of MIME
// base64, is ignored. Throws for other characters, padding other than at the end, mixed alphabets or a length no
// base64 string has.
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, "");
  const padding = clean.length - clean.replace(/=+$/, "").length;
  if (padding > 2 || (padding > 0 && clean.length % 4 !== 0)) {
    throw new Error("Invalid base64 padding");
  }
  const dataLength = clean.length - padding;
  if (dataLength % 4 === 1) {
    throw new Error("Invalid base64 string length");
  }

  const out = new Uint8Array(Math.floor((dataLength * 3) / 4));
  let outIdx = 0;
  let buffer = 0;
  let bits = 0;
  let standard = false;
  let urlSafe = false;
  for (let i = 0; i < dataLength; i++) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? BASE64_LOOKUP[code] : -1;
    if (value < 0) {
      throw new Error(`Invalid base64 character ${JSON.stringify(clean[i])}`);
    }
    if (code === 0x2b || code === 0x2f) standard = true;
    else if (code === 0x2d || code === 0x5f) urlSafe = true;

    buffer = ((buffer << 6) | value) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIdx++] = (buffer >> bits) & 0xff;
    }
  }
  if (standard && urlSafe) {
    throw new Error("Invalid base64: mixes the standard and URL-safe alphabets");
  }
  return out;
}

// Base64 characters to read to decode more than `maxItems` bytes, doubled for whitespace such as MIME line breaks
export function base64ReadLimit(maxItems: number): number {
  return Math.ceil((maxItems + 1) / 3) * 8;
}

// Base64-decodes `encoded` as text if the bytes are printable ASCII or UTF-8 text, otherwise as hex, e.g. a key.
// At most `maxItems` bytes, ending with "..." when cut. `inputTruncated`: `encoded` is only the start of the value,
// read up to base64ReadLimit(). Throws for invalid base64.
export function decodeBase64Value(encoded: string, maxItems: number, inputTruncated: boolean = false): string {
  let clean = encoded.replace(/\s+/g, "");
  if (inputTruncated) clean = clean.slice(0, clean.length - (clean.length % 4));
  const bytes = base64ToBytes(clean);
  const truncated = inputTruncated || bytes.length > maxItems;
  const shown = bytes.subarray(0, Math.min(bytes.length, maxItems));
  // a cut multi-byte character would make the text look binary
  const text = truncated ? trimIncompleteUtf8Tail(shown) : shown;
  return (isText(text) ? bytesToString(text) : toHex(shown)) + (truncated ? "..." : "");
}

// Printable ASCII or valid UTF-8 without control characters
function isText(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte >= 0x80 || isPrintable(byte)) && isValidUtf8(bytes);
}

// e.g. ` (hooks.yaml)` for log messages, "" if unknown
export function fromSource(source?: string): string {
  return source ? ` (${source})` : "";
}
