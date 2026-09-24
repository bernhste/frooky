import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../../../shared/frookySettings";
import { ReferenceTypeDecoder } from "../../builtin/ReferenceTypeDecoder";
import { JavaDecoderResolver } from "../../javaDecoderResolver";

const classCache = new Map<string, Java.Wrapper>();
function useCached(className: string): Java.Wrapper {
  let javaClass = classCache.get(className);
  if (!javaClass) {
    javaClass = Java.use(className);
    classCache.set(className, javaClass);
  }
  return javaClass;
}

let reflectArray: Java.Wrapper | undefined;
function getReflectArray(): Java.Wrapper {
  return (reflectArray ??= Java.use("java.lang.reflect.Array"));
}

// caches the result (including a negative one) per runtime class, keyed by className - a class's
// TYPE field never changes, and without caching, every non-wrapper entry (String, Parcelable, ...)
// would pay for a reflective field lookup that throws on every single decode() call
const boxedPrimitiveTypeCache = new Map<string, string | null>();

/**
 * Every boxed primitive wrapper (`Integer`, `Boolean`, ...) declares a public static `TYPE` field
 * holding its primitive `Class` (`Integer.TYPE === int.class`), and `Class.getName()` on that
 * primitive `Class` returns the primitive type name itself (`"int"`, `"boolean"`, ...) - which,
 * conveniently, is also the exact prefix of that wrapper's unboxing method (`intValue()`,
 * `booleanValue()`, ...). So the primitive type - and the method that unboxes it - can be derived
 * at runtime from any class, instead of hardcoding the 8 wrapper class names.
 */
function getBoxedPrimitiveType(entry: Java.Wrapper, className: string): string | null {
  const cached = boxedPrimitiveTypeCache.get(className);
  if (cached !== undefined) return cached;

  let primitiveType: string | null = null;
  try {
    const typeFieldValue = entry.getClass().getField("TYPE").get(null);
    const typeClass = Java.cast(typeFieldValue, Java.use("java.lang.Class"));
    if (typeClass.isPrimitive()) {
      primitiveType = typeClass.getName();
    }
  } catch {
    // no public static TYPE field (NoSuchFieldException) - not a boxed primitive wrapper
  }

  boxedPrimitiveTypeCache.set(className, primitiveType);
  return primitiveType;
}

const TYPED_ARRAY_GETTERS: Record<string, string> = {
  "[Z": "getBooleanArray",
  "[B": "getByteArray",
  "[C": "getCharArray",
  "[S": "getShortArray",
  "[I": "getIntArray",
  "[J": "getLongArray",
  "[F": "getFloatArray",
  "[D": "getDoubleArray",
  "[Ljava.lang.String;": "getStringArray",
};

/**
 * Decode all key/value pairs from a Bundle.
 */
export class BundleDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    const values: DecodedValue[] = [];
    const keys = value.keySet().toArray();

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i].toString();
      values.push(this.decodeEntry(value, key, value.get(key), true));
    }

    return {
      type: this.type,
      value: values,
    };
  }

  private decodeEntry(bundle: Java.Wrapper, key: string, entry: Java.Wrapper | null, isBundleValue: boolean): DecodedValue {
    if (entry == null) {
      return { type: "null", name: key, value: null };
    }

    const settings: DecoderSettings = this.settings;
    const className: string = entry.$className;

    if (className.startsWith("[")) {
      return this.decodeArray(bundle, key, className, entry, isBundleValue);
    }

    const castEntry = Java.cast(entry, useCached(className));

    const primitiveType = getBoxedPrimitiveType(entry, className);
    if (primitiveType) {
      const unboxed = castEntry[`${primitiveType}Value`]();
      const decodable = { type: primitiveType, name: key, settings };
      const decoded = JavaDecoderResolver.resolveDecoder(decodable).decode(unboxed);
      return { type: decoded.type, name: key, value: decoded.value };
    }

    const decoded = new ReferenceTypeDecoder({ type: className, name: key, settings }).decode(castEntry);
    return { type: decoded.type, name: key, value: (decoded.value as DecodedValue).value };
  }

  private decodeArray(bundle: Java.Wrapper, key: string, className: string, entry: Java.Wrapper, isBundleValue: boolean): DecodedValue {
    const decodeLimit = this.settings.decodeLimit;
    // only re-fetch through a typed getter for the extra itself - a nested array element reached
    // via reflection below has no key of its own to re-fetch by
    const typedGetter = isBundleValue ? TYPED_ARRAY_GETTERS[className] : undefined;

    if (typedGetter) {
      const getter: Java.MethodDispatcher = bundle[typedGetter];
      const typedArray = getter.call(bundle, key) as ArrayLike<unknown> | null;
      const items = typedArray == null ? [] : this.takeLimited(typedArray, typedArray.length, decodeLimit);
      return { type: className, name: key, value: items };
    }

    const length: number = getReflectArray().getLength(entry);
    const decodeLen = Math.min(length, decodeLimit);
    const items: unknown[] = new Array(decodeLen);
    for (let i = 0; i < decodeLen; i++) {
      items[i] = this.decodeEntry(bundle, key, getReflectArray().get(entry, i), false).value;
    }
    if (length > decodeLen) {
      items.push(`[truncated at ${decodeLimit}]`);
    }
    return { type: className, name: key, value: items };
  }

  private takeLimited(arrayLike: ArrayLike<unknown>, total: number, limit: number): unknown[] {
    const decodeLen = Math.min(total, limit);
    const items = new Array(decodeLen);
    for (let i = 0; i < decodeLen; i++) {
      items[i] = arrayLike[i];
    }
    if (total > decodeLen) {
      items.push(`[truncated at ${limit}]`);
    }
    return items;
  }
}
