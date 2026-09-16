import Java from "frida-java-bridge";
import { DecodedValue } from "../../../shared/decoders/decodedValue";

// Keyed by `${className}#${prefix}` since declared constants never change at runtime, so results
// are reflected once and shared across every decoder instance that requests the same class/prefix
// instead of re-walking the class's declared fields per hook.
const constantCache = new Map<string, DecodedValue[]>();

/**
 * Reads a static field's value using the reflection getter matching its declared type. `long`
 * fields are stringified since Frida represents them as Int64/UInt64 wrappers that lose precision
 * if coerced to a JS number; every other type (including `java.lang.String`, which Frida already
 * unwraps to a JS string) is returned as-is.
 */
function readFieldValue(field: Java.Wrapper, typeName: string): unknown {
  switch (typeName) {
    case "int":
      return field.getInt(null) >>> 0;
    case "short":
      return field.getShort(null);
    case "byte":
      return field.getByte(null);
    case "char":
      return field.getChar(null);
    case "boolean":
      return field.getBoolean(null);
    case "float":
      return field.getFloat(null);
    case "double":
      return field.getDouble(null);
    case "long":
      return field.getLong(null).toString();
    default:
      return field.get(null);
  }
}

// java.lang.reflect.Modifier.STATIC, checked as a raw bit instead of via Java.use() since this
// runs once per field on every newly-encountered class/prefix pair.
const STATIC_MODIFIER = 0x0008;

/**
 * Reflects every `static` field of `className` whose name starts with `prefix` (e.g. Intent's
 * `FLAG_*` or `URI_*` constants, or "" to match every declared constant), decoding each field's
 * value according to its actual declared type rather than assuming `int`. Instance fields are
 * skipped - reading them the same way as a static field (passing `null` as the target) throws.
 */
export function decodeConstantValues(className: string, prefix: string): DecodedValue[] {
  const cacheKey = `${className}#${prefix}`;
  const cached = constantCache.get(cacheKey);
  if (cached) return cached;

  const JavaClass = Java.use(className);
  const fields = JavaClass.class.getDeclaredFields();
  const constants: DecodedValue[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const name: string = f.getName();
    if (!name.startsWith(prefix) || (f.getModifiers() & STATIC_MODIFIER) === 0) continue;

    const type: string = f.getType().getName();
    f.setAccessible(true);
    constants.push({ type, name, value: readFieldValue(f, type) });
  }

  constantCache.set(cacheKey, constants);
  return constants;
}
