import Java from "frida-java-bridge";
import { Decodable } from "../../../shared/decoders/decodable";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { logger } from "../../../shared/logger";
import { namePatternToRegExp } from "../../../shared/utils";

// constants per `${className}#${pattern}`
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

// Java.use() of `className` as the class loader of `visibleTo` sees it, e.g. a class of constants for a hooked class.
// Java.use() only knows the classes of its default class loader, so otherwise the class loader that has `visibleTo`
// (e.g. one of a dex the app loads itself) is looked up among the app's class loaders.
function useClassVisibleTo(className: string, visibleTo?: string): Java.Wrapper {
  try {
    return Java.use(className);
  } catch (e) {
    if (!visibleTo) throw e;
  }
  for (const loader of Java.enumerateClassLoadersSync()) {
    try {
      loader.loadClass(visibleTo);
      return Java.ClassFactory.get(Java.retain(loader)).use(className);
    } catch {
      // this class loader doesn't have `visibleTo`, or doesn't see `className`
    }
  }
  throw new Error(`Class '${className}' not found, neither in the default class loader nor in the one of '${visibleTo}'`);
}

// java.lang.reflect.Modifier.STATIC | java.lang.reflect.Modifier.FINAL
const STATIC_FINAL_MODIFIERS = 0x0008 | 0x0010;

// The `static final` fields of `className` whose name matches `pattern`, in which `*` matches any characters, e.g.
// Intent's `FLAG_*`. `visibleTo` is a class whose class loader has `className`, e.g. the hooked class, for a class
// that isn't in the default class loader. Throws if no class loader has `className`.
export function decodeConstantValues(className: string, pattern = "*", visibleTo?: string): DecodedValue[] {
  const cacheKey = `${className}#${pattern}`;
  const cached = constantCache.get(cacheKey);
  if (cached) {
    logger.debug(`Constant cache hit: ${cacheKey}, ${cached.length} constant(s)`);
    return cached;
  }

  const JavaClass = useClassVisibleTo(className, visibleTo);
  const namePattern = namePatternToRegExp(pattern);
  const fields = JavaClass.class.getDeclaredFields();
  const constants: DecodedValue[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const name: string = f.getName();
    if (!namePattern.test(name) || (f.getModifiers() & STATIC_FINAL_MODIFIERS) !== STATIC_FINAL_MODIFIERS) continue;

    const type: string = f.getType().getName();
    f.setAccessible(true);
    constants.push({ type, name, value: readFieldValue(f, type) });
  }

  constantCache.set(cacheKey, constants);
  logger.debug(`Constant cache miss: ${cacheKey}, reflected ${constants.length} constant(s)`);
  return constants;
}

// The constants of type `type` of `className` whose name matches `pattern`, e.g. the `int` fields `*_MODE` of
// `javax.crypto.Cipher`. Logs a warning and returns none if the class isn't found or has no such constant.
// `visibleTo`: see decodeConstantValues().
export function classConstants(className: string, pattern: string, type: string, visibleTo?: string): DecodedValue[] {
  try {
    const constants = decodeConstantValues(className, pattern, visibleTo).filter((constant) => constant.type === type);
    if (constants.length === 0) {
      logger.warn(`'${className}' has no static final ${type} field matching '${pattern}', the value is decoded as it is.`);
    }
    return constants;
  } catch (e) {
    logger.warn(`${e instanceof Error ? e.message : e}, the value is decoded as it is.`);
    return [];
  }
}

// The constants of `decoder: constants` and `decoder: bitmask` in a Java hook: the `static final` fields of
// `config.class`, or else of the hooked class, that match `config.fields`. None with a map in `config.constants`, or
// without a class.
export function configClassConstants(decodable: Decodable): DecodedValue[] {
  const config = decodable.settings.config;
  const className = config?.class ?? decodable.declaringClass;
  if (config?.constants || !className) return [];
  return classConstants(className, config?.fields ?? "*", decodable.type, decodable.declaringClass);
}
