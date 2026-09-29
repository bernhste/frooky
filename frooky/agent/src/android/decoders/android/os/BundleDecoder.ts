import Java from "frida-java-bridge";
import { childSettings, isMaxDepthReached, MAX_DEPTH_MARKER, RecursiveDecoder } from "../../../../shared/decoders/recursiveDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../../../shared/frookySettings";
import { ArrayDecoder, decodePrimitiveArray } from "../../builtin/ArrayDecoder";
import { ReferenceTypeDecoder } from "../../builtin/ReferenceTypeDecoder";
import { JavaDecoderResolver } from "../../javaDecoderResolver";
import { logger } from "../../../../shared/logger";

const classCache = new Map<string, Java.Wrapper>();
function useCached(className: string): Java.Wrapper {
  let javaClass = classCache.get(className);
  if (javaClass) {
    logger.debug(`Bundle class cache hit: ${className}`);
  } else {
    logger.debug(`Bundle class cache miss: ${className}`);
    javaClass = Java.use(className);
    classCache.set(className, javaClass);
  }
  return javaClass;
}

let reflectArray: Java.Wrapper | undefined;
function getReflectArray(): Java.Wrapper {
  return (reflectArray ??= Java.use("java.lang.reflect.Array"));
}

// primitive type per class name, null for classes that aren't boxed primitives
const boxedPrimitiveTypeCache = new Map<string, string | null>();

// Boxed primitives declare a static `TYPE` field holding their primitive class, whose name is also the
// prefix of the unboxing method, e.g. `Integer.TYPE.getName()` is `int` -> `intValue()`.
function getBoxedPrimitiveType(entry: Java.Wrapper, className: string): string | null {
  const cached = boxedPrimitiveTypeCache.get(className);
  if (cached !== undefined) {
    logger.debug(`Boxed primitive cache hit: ${className} -> ${cached ?? "not boxed"}`);
    return cached;
  }

  let primitiveType: string | null = null;
  try {
    const typeFieldValue = entry.getClass().getField("TYPE").get(null);
    const typeClass = Java.cast(typeFieldValue, Java.use("java.lang.Class"));
    if (typeClass.isPrimitive()) {
      primitiveType = typeClass.getName();
    }
  } catch {
    // no TYPE field: not a boxed primitive
  }

  boxedPrimitiveTypeCache.set(className, primitiveType);
  logger.debug(`Boxed primitive cache miss: ${className} -> ${primitiveType ?? "not boxed"}`);
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

export class BundleDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "BundleDecoder";
  readonly description = "Decodes an `android.os.Bundle` into its key/value pairs, including typed arrays and nested Bundles.";

  protected decodeRecursive(value: Java.Wrapper, entrySettings: DecoderSettings): DecodedValue {
    const values: DecodedValue[] = [];
    const keys = value.keySet().toArray();
    const maxItems = this.settings.maxItems;
    const decodeLen = Math.min(keys.length, maxItems);

    for (let i = 0; i < decodeLen; i++) {
      const key = keys[i].toString();
      values.push(this.decodeEntry(value, key, value.get(key), true, entrySettings));
    }
    if (keys.length > decodeLen) {
      values.push({ type: "java.lang.String", value: `[truncated at ${maxItems}]` });
    }

    return {
      type: this.type,
      value: values,
    };
  }

  private decodeEntry(
    bundle: Java.Wrapper,
    key: string,
    entry: Java.Wrapper | null,
    isBundleValue: boolean,
    settings: DecoderSettings,
  ): DecodedValue {
    if (entry == null) {
      return { type: "null", name: key, value: null };
    }

    const className: string = entry.$className;

    if (className.startsWith("[")) {
      return this.decodeArray(bundle, key, className, entry, isBundleValue, settings);
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

  private decodeArray(
    bundle: Java.Wrapper,
    key: string,
    className: string,
    entry: Java.Wrapper,
    isBundleValue: boolean,
    settings: DecoderSettings,
  ): DecodedValue {
    if (isMaxDepthReached(settings)) {
      return { type: className, name: key, value: MAX_DEPTH_MARKER };
    }

    const maxItems = settings.maxItems;
    // only a Bundle value can be re-fetched by key through a typed getter, a nested array element can't
    const typedGetter = isBundleValue ? TYPED_ARRAY_GETTERS[className] : undefined;

    if (typedGetter) {
      const getter: Java.MethodDispatcher = bundle[typedGetter];
      const typedArray = getter.call(bundle, key) as ArrayLike<unknown> | null;
      const items = typedArray == null ? [] : this.takeLimited(typedArray, typedArray.length, maxItems, className);
      return { type: className, name: key, value: items };
    }

    const length: number = getReflectArray().getLength(entry);
    const decodeLen = Math.min(length, maxItems);
    const items: unknown[] = new Array(decodeLen);
    const elementSettings = childSettings(settings);
    for (let i = 0; i < decodeLen; i++) {
      items[i] = this.decodeEntry(bundle, key, getReflectArray().get(entry, i), false, elementSettings).value;
    }
    if (length > decodeLen) {
      items.push(`[truncated at ${maxItems}]`);
    }
    return { type: className, name: key, value: items };
  }

  private takeLimited(arrayLike: ArrayLike<unknown>, total: number, limit: number, className?: string): unknown[] {
    const decodeLen = Math.min(total, limit);
    let items: unknown[];
    if (className && typeof (arrayLike as any).withElements === "function") {
      items = decodePrimitiveArray(arrayLike, className, decodeLen);
    } else {
      items = new Array(decodeLen);
      for (let i = 0; i < decodeLen; i++) {
        items[i] = arrayLike[i];
      }
    }
    if (total > decodeLen) {
      items.push(`[truncated at ${limit}]`);
    }
    return items;
  }
}
