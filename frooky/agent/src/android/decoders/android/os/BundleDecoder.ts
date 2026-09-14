import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../../../shared/frookySettings";
import { PrimitiveDecoder } from "../../builtin/BasicDecoder";
import { ReferenceTypeDecoder } from "../../builtin/ReferenceTypeDecoder";

const BOXED_PRIMITIVES: Record<string, { primitiveType: string; unbox: (entry: Java.Wrapper) => unknown }> = {
  "java.lang.Boolean": { primitiveType: "boolean", unbox: (entry) => entry.booleanValue() },
  "java.lang.Byte": { primitiveType: "byte", unbox: (entry) => entry.byteValue() },
  "java.lang.Character": { primitiveType: "char", unbox: (entry) => entry.charValue() },
  "java.lang.Short": { primitiveType: "short", unbox: (entry) => entry.shortValue() },
  "java.lang.Integer": { primitiveType: "int", unbox: (entry) => entry.intValue() },
  "java.lang.Long": { primitiveType: "long", unbox: (entry) => entry.longValue() },
  "java.lang.Float": { primitiveType: "float", unbox: (entry) => entry.floatValue() },
  "java.lang.Double": { primitiveType: "double", unbox: (entry) => entry.doubleValue() },
};

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

/**
 * Decode all key/value pairs from a Bundle.
 */
export class BundleDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    const values: DecodedValue[] = [];
    const keys = value.keySet().toArray();

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i].toString();
      values.push(this.decodeEntry(key, value.get(key)));
    }

    return {
      type: this.decodable.type,
      value: values,
    };
  }

  private decodeEntry(key: string, entry: Java.Wrapper | null): DecodedValue {
    if (entry == null) {
      return { type: "null", name: key, value: null };
    }

    const settings: DecoderSettings = this.decodable.settings;
    const className: string = entry.getClass().getName();

    if (className.startsWith("[")) {
      const length: number = getReflectArray().getLength(entry);
      const items: unknown[] = new Array(length);
      for (let i = 0; i < length; i++) {
        items[i] = this.decodeEntry(key, getReflectArray().get(entry, i)).value;
      }
      return { type: className, name: key, value: items };
    }

    const castEntry = Java.cast(entry, useCached(className));

    const boxedPrimitive = BOXED_PRIMITIVES[className];
    if (boxedPrimitive) {
      const decoded = new PrimitiveDecoder({ type: boxedPrimitive.primitiveType, name: key, settings }).decode(
        boxedPrimitive.unbox(castEntry) as Java.Wrapper,
      );
      return { type: decoded.type, name: key, value: decoded.value };
    }

    const decoded = new ReferenceTypeDecoder({ type: className, name: key, settings }).decode(castEntry);
    return { type: decoded.type, name: key, value: (decoded.value as DecodedValue).value };
  }
}
