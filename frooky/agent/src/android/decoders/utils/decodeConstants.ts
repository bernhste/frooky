import Java from "frida-java-bridge";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { logger } from "../../../shared/logger";

// constants per `${className}#${prefix}`
const constantCache = new Map<string, DecodedValue[]>();

// Reads a static field with the getter of its type. `long` is returned as a string to keep its precision.
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

// java.lang.reflect.Modifier.STATIC
const STATIC_MODIFIER = 0x0008;

// The static fields of `className` whose name starts with `prefix` ("" for all), e.g. Intent's `FLAG_*`.
export function decodeConstantValues(className: string, prefix: string): DecodedValue[] {
  const cacheKey = `${className}#${prefix}`;
  const cached = constantCache.get(cacheKey);
  if (cached) {
    logger.debug(`Constant cache hit: ${cacheKey}, ${cached.length} constant(s)`);
    return cached;
  }

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
  logger.debug(`Constant cache miss: ${cacheKey}, reflected ${constants.length} constant(s)`);
  return constants;
}
