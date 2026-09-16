export class FilterMismatchError extends Error {}

/**
 * Converts a wildcard pattern (e.g. `org.owasp.*.HttpClient`) into a `RegExp` that fully matches
 * (`^...$`) strings satisfying it. `*` matches exactly one dot-separated segment (i.e. it never
 * matches a literal `.`), so wildcards apply at the package/class level rather than spanning packages.
 * @param pattern - The wildcard pattern.
 * @returns A `RegExp` matching strings that satisfy `pattern`.
 */
export function wildcardPatternToRegExp(pattern: string): RegExp {
  const segments = pattern.split("*").map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${segments.join("[^.]+")}$`);
}

/**
 * Generates a v4 UUID
 * @returns {string} v4 UUID (e.g. "6b5354ed-8c3e-476d-8999-96b2251d8a3c")
 */
export function uuidv4(): string {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c: string): string =>
    ((+c ^ ((Math.random() * 16) >> (+c / 4))) & 15).toString(16),
  );
}

const HEX_TABLE: readonly string[] = Object.freeze(Array.from({ length: 256 }, (_, i) => (i < 16 ? "0" : "") + i.toString(16)));

/**
 * Determines the actual length to decode and whether ellipsis is needed.
 * @param availableLength - Number of decodable items (bytes or characters) available.
 * @param length - Maximum number of items to decode.
 * @returns A tuple [lengthToDecode, ellipsis] where lengthToDecode is the actual length and ellipsis is "..." or "".
 * @throws {RangeError} If length is negative.
 */
function getDecodeBounds(availableLength: number, length: number): [number, string] {
  if (length < 0) {
    throw new RangeError("Length cannot be negative");
  }

  if (availableLength > length) {
    return [length, "..."];
  }
  return [availableLength, ""];
}

/**
 * Reads at most `limit` elements from an array-like value, without reading elements beyond that -
 * important when `array` is a Java array proxy, where every element access crosses the JS/Java bridge.
 * @param array - Array-like value to read from (e.g. a Java byte[] proxy).
 * @param limit - Maximum number of elements to read.
 * @returns A tuple [bytes, truncated] where truncated is true if `array` had more elements than `limit`.
 */
export function readBytesLimited(array: ArrayLike<number>, limit: number): [bytes: Uint8Array, truncated: boolean] {
  const readLength = Math.min(array.length, limit);
  const bytes = new Uint8Array(readLength);

  for (let i = 0; i < readLength; i++) {
    bytes[i] = array[i];
  }

  return [bytes, array.length > limit];
}

/**
 * Checks if a byte is printable ASCII.
 * @param byte - Byte value to check.
 * @returns True if the byte represents a printable character (32-126) or tab/newline/carriage return.
 */
function isPrintable(byte: number): boolean {
  return (byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13;
}

/**
 * Fast bytes to hexadecimal conversion.
 * @param bytes - Bytes to be decoded as hexadecimal.
 * @param length - Number of bytes which will be decoded. Defaults to Infinity.
 * @returns The hexadecimal decoded bytes (e.g., "0x22aa3482ef...")
 * @throws {RangeError} If length is negative.
 */
export function toHex(bytes: Uint8Array, length: number = Infinity): string {
  const [lengthToDecode, ellipsis] = getDecodeBounds(bytes.length, length);
  const hexArray = new Array(lengthToDecode);

  for (let i = 0; i < lengthToDecode; i++) {
    const byte = bytes[i];
    hexArray[i] = HEX_TABLE[byte];
  }

  return "0x" + hexArray.join("") + ellipsis;
}

/**
 * Fast bytes to ascii conversion.
 * @param bytes - Bytes to be decoded as ascii.
 * @param length - Number of bytes which will be decoded. Defaults to Infinity.
 * @param placeholder - Placeholder for ascii representation of not-printable bytes. Defaults to "."
 * @returns The decoded bytes (e.g., "...qsf._fHello.!.a....")
 * @throws {RangeError} If length is negative.
 */
export function toAscii(bytes: Uint8Array, length: number = Infinity, placeholder: string = "."): string {
  const [lengthToDecode, ellipsis] = getDecodeBounds(bytes.length, length);
  const asciiArray = new Array(lengthToDecode);

  for (let i = 0; i < lengthToDecode; i++) {
    const byte = bytes[i];
    asciiArray[i] = isPrintable(byte) ? String.fromCharCode(byte) : placeholder;
  }

  return asciiArray.join("") + ellipsis;
}

/**
 * Checks whether a byte sequence is well-formed UTF-8.
 * @param bytes - Bytes to validate.
 * @returns True if every byte participates in a well-formed UTF-8 sequence.
 */
export function isValidUtf8(bytes: Uint8Array): boolean {
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

    // rejects overlong encodings and UTF-16 surrogate halves, which are not valid UTF-8 code points
    if (codePoint < minCodePoint || (codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > 0x10ffff) {
      return false;
    }

    i += extraBytes + 1;
  }
  return true;
}

/**
 * Decodes a well-formed UTF-8 byte sequence into a string.
 * @param bytes - Bytes to decode. Must already be validated with {@link isValidUtf8}.
 * @param length - Maximum number of decoded characters to return. Defaults to Infinity.
 * @returns The decoded string, truncated to `length` characters with an ellipsis if needed.
 * @throws {RangeError} If length is negative.
 */
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

/**
 * Fast bytes to hexadecimal and ASCII conversion.
 * @param bytes - Bytes to be decoded.
 * @param length - Number of bytes which will be decoded. Defaults to Infinity.
 * @param placeholder - Placeholder for ascii representation of not-printable bytes. Defaults to "."
 * @returns A tuple [hex, ascii] with the decoded representations.
 * @throws {RangeError} If length is negative.
 */
export function toHexAndAscii(bytes: Uint8Array, length: number = Infinity, placeholder: string = "."): [string, string] {
  const [lengthToDecode, ellipsis] = getDecodeBounds(bytes.length, length);
  const hexArray = new Array(lengthToDecode);
  const asciiArray = new Array(lengthToDecode);

  for (let i = 0; i < lengthToDecode; i++) {
    const byte = bytes[i];
    hexArray[i] = HEX_TABLE[byte];
    asciiArray[i] = isPrintable(byte) ? String.fromCharCode(byte) : placeholder;
  }

  return ["0x" + hexArray.join("") + ellipsis, asciiArray.join("") + ellipsis];
}

export function sleepMilliseconds(milliSeconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliSeconds));
}

export function sleepSeconds(seconds: number): Promise<void> {
  return sleepMilliseconds(seconds * 1000);
}
