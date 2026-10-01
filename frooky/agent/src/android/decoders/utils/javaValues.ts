import Java from "frida-java-bridge";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../../shared/frookySettings";
import { logger } from "../../../shared/logger";
import { readBytesLimited, toHex } from "../../../shared/utils";
import { JavaDecoderResolver } from "../javaDecoderResolver";

const classCache = new Map<string, Java.Wrapper>();

// Java.use(), looked up once per class
export function useJavaClass(className: string): Java.Wrapper {
  let javaClass = classCache.get(className);
  if (!javaClass) {
    javaClass = Java.use(className);
    classCache.set(className, javaClass);
  }
  return javaClass;
}

// Java.use() of a class that `instance` can see, e.g. its own class or a superclass. Java.use() only knows the
// classes of its default class loader, so the class of an app (or of a dex the app loads itself) is looked up
// through the class loader of `instance` instead.
export function useClassOf(instance: Java.Wrapper, className: string): Java.Wrapper {
  let javaClass = classCache.get(className);
  if (!javaClass) {
    try {
      javaClass = Java.use(className);
    } catch {
      const loader = Java.cast(instance, useJavaClass("java.lang.Object")).getClass().getClassLoader();
      javaClass = Java.ClassFactory.get(loader).use(className);
    }
    classCache.set(className, javaClass);
  }
  return javaClass;
}

// Reads each field with its function. A read that throws (hidden API, missing on this API level, ...) is null,
// so one field doesn't cost the others. `what` names the object in the debug log.
export function decodeFields(what: string, fields: Record<string, () => unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, read] of Object.entries(fields)) {
    try {
      const value = read();
      result[name] = value === undefined ? null : value;
    } catch (e) {
      logger.debug(`Unable to read ${what}.${name}: ${e}`);
      result[name] = null;
    }
  }
  return result;
}

// A Java byte[] as hex, e.g. "0x0a1b2c", up to `maxItems` bytes and ending with "..." if cut off.
export function javaBytesToHex(bytes: Java.Wrapper | null, maxItems: number): string | null {
  if (bytes == null) return null;
  const [data, truncated] = readBytesLimited(bytes as unknown as ArrayLike<number>, maxItems);
  return toHex(data) + (truncated ? "..." : "");
}

// SHA-256 of a whole Java byte[] as lowercase hex. Computed by Frida, not MessageDigest, so hooks on
// MessageDigest don't fire for it.
export function javaBytesSha256(bytes: Java.Wrapper | null): string | null {
  if (bytes == null) return null;
  const [data] = readBytesLimited(bytes as unknown as ArrayLike<number>, Infinity);
  return Checksum.compute("sha256", data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
}

// A java.util.Date (milliseconds since the epoch) as an ISO 8601 string in UTC.
export function javaDateToIso(date: Java.Wrapper | null): string | null {
  if (date == null) return null;
  return new Date(Number(date.getTime())).toISOString();
}

// Decodes a nested object by its runtime class, e.g. the Cipher of a CryptoObject. Unwraps the result of
// ReferenceTypeDecoder, whose outer type would only repeat the runtime class.
export function decodeNested(value: Java.Wrapper | null, name: string, settings: DecoderSettings): DecodedValue {
  if (value == null) return { type: "null", name, value: null };
  const decoder = JavaDecoderResolver.resolveDecoder({ type: value.$className, name, settings });
  const decoded = decoder.decode(value);
  if (decoder.decoderName === "ReferenceTypeDecoder") {
    const inner = decoded.value as DecodedValue;
    return { type: inner.type, name, value: inner.value };
  }
  return { ...decoded, name };
}
