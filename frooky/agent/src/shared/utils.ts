export class FilterMismatchError extends Error {}

// `*` matches exactly one dot-separated segment, e.g. `org.owasp.*.HttpClient` matches
// `org.owasp.net.HttpClient` but not `org.owasp.net.http.HttpClient`.
export function wildcardPatternToRegExp(pattern: string): RegExp {
  const segments = pattern.split("*").map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${segments.join("[^.]+")}$`);
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
export function readBytesLimited(array: ArrayLike<number>, limit: number): [bytes: Uint8Array, truncated: boolean] {
  const total = array.length;
  const readLength = Math.min(total, limit);

  if (readLength === 0) {
    return [new Uint8Array(0), total > limit];
  }

  if (typeof (array as any).withElements === "function") {
    const bytes = (array as any).withElements((elements: NativePointer) => {
      const raw = elements.readByteArray(readLength);
      return raw !== null ? new Uint8Array(raw) : new Uint8Array(0);
    });
    return [bytes, total > limit];
  }

  const bytes = new Uint8Array(readLength);
  for (let i = 0; i < readLength; i++) {
    bytes[i] = array[i];
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

// e.g. ` (hooks.yaml)` for log messages, "" if unknown
export function fromSource(source?: string): string {
  return source ? ` (${source})` : "";
}
