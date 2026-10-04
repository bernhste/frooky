import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../shared/frookySettings";
import { bytesToString, trimIncompleteUtf8Tail } from "../../shared/utils";
import { countArg, DecoderArgValues, logDecodeFailure } from "../../shared/decoders/decoderArgs";

// Reads byte chunks up to the NUL terminator, bounded by memory page boundaries so it never reads
// into unmapped memory. Reads at most `limit` bytes plus one to tell whether the string continues.
export function readCString(input: NativePointer, limit: number): [bytes: Uint8Array, truncated: boolean] {
  if (limit <= 0) {
    try {
      const byte0 = input.readU8();
      return [new Uint8Array(0), byte0 !== 0];
    } catch (_) {
      return [new Uint8Array(0), false];
    }
  }

  const pageSize = Process.pageSize;
  const targetBytes = limit + 1;
  const chunks: Uint8Array[] = [];
  let totalRead = 0;
  let nulOffset = -1;

  while (totalRead < targetBytes) {
    const currentPtr = input.add(totalRead);
    const offsetInPage = currentPtr.and(pageSize - 1).toUInt32();
    const bytesInPage = pageSize - offsetInPage;
    const chunkSize = Math.min(targetBytes - totalRead, bytesInPage);

    let raw: ArrayBuffer | null = null;
    try {
      raw = currentPtr.readByteArray(chunkSize);
    } catch (_) {
      raw = null;
    }
    if (raw === null) break;

    const chunk = new Uint8Array(raw);
    const idx = chunk.indexOf(0);
    if (idx !== -1) {
      nulOffset = totalRead + idx;
      chunks.push(chunk.subarray(0, idx));
      totalRead += idx;
      break;
    }

    chunks.push(chunk);
    totalRead += chunkSize;
  }

  if (chunks.length === 0) {
    return [new Uint8Array(0), false];
  }

  const truncated = nulOffset === -1 && totalRead >= targetBytes;
  const resultLength = truncated ? limit : Math.min(totalRead, limit);

  if (chunks.length === 1) {
    const single = chunks[0];
    return [single.length === resultLength ? single : single.subarray(0, resultLength), truncated];
  }

  const combined = new Uint8Array(resultLength);
  let written = 0;
  for (const chunk of chunks) {
    const toWrite = Math.min(chunk.length, resultLength - written);
    combined.set(chunk.subarray(0, toWrite), written);
    written += toWrite;
    if (written >= resultLength) break;
  }

  return [combined, truncated];
}

// Reads `length` bytes, at most `limit`. NUL bytes are data here, e.g. in a buffer from `read`.
export function readBoundedString(input: NativePointer, length: number, limit: number): [bytes: Uint8Array, truncated: boolean] {
  const rawBytes = input.readByteArray(Math.min(length, limit));
  const bytes = rawBytes === null ? new Uint8Array(0) : new Uint8Array(rawBytes);
  return [bytes, length > limit];
}

// Decodes a string as UTF-8, else as ASCII, for `char *` and `decoder: string`. The roles in `args`, both in bytes:
// `offset` skips bytes at the start, `length` is the length of the string, otherwise it ends at its NUL terminator.
// At most `maxItems` bytes are decoded, a longer string ends with `...`. Returns null for NULL or unreadable memory.
export function decodeNativeString(input: NativePointer, settings: DecoderSettings, args: DecoderArgValues | undefined, type: string): string | null {
  if (input.isNull()) {
    return null;
  }

  try {
    const maxItems = settings.maxItems;
    const start = input.add(countArg(args, "offset") ?? 0);
    const length = countArg(args, "length");
    const [bytes, truncated] = length !== undefined ? readBoundedString(start, length, maxItems) : readCString(start, maxItems);
    // a cut multi-byte character would make the whole string decode as ASCII
    return truncated ? bytesToString(trimIncompleteUtf8Tail(bytes)) + "..." : bytesToString(bytes);
  } catch (e) {
    logDecodeFailure(`Unable to decode ${type} as a string`, e);
    return null;
  }
}

export class NativeStringDecoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeStringDecoder";
  readonly description = "Reads the memory a pointer points to as a string, for pointer types not decoded as strings by default (e.g. `void *`).";

  public decode(value: NativePointer, args?: DecoderArgValues): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: decodeNativeString(value, this.settings, args, this.type),
    };
  }
}
