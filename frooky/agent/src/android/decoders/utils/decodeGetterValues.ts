import Java from "frida-java-bridge";
import { Decodable } from "../../../shared/decoders/decodable";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../../shared/frookySettings";
import { JAVA_PRIMITIVE_TYPES, JavaDecoderResolver } from "../javaDecoderResolver";
import { logger } from "../../../shared/logger";
import { StringDecoder } from "../builtin/StringDecoder";
import { javaBytesToHex, useClassOf } from "./javaValues";

// java.lang.reflect.Modifier bits
const MODIFIER_PUBLIC = 0x1;
const MODIFIER_STATIC = 0x8;

type JavaMethodDescriptor = {
  methodName: string;
  propertyName: string;
  returnType: string;
  isPrimitive: boolean;
  needsUnwrap: boolean;
};

export interface GetterOptions {
  // prefixes of the getter names, e.g. `["get", "is"]`: `getKeySize` -> `keySize`, `isEnabled` -> `enabled`
  prefixes?: string[];
  // class whose getters are called, by default the runtime class. A decoder registered for a superclass or an
  // interface passes it, e.g. `android.content.Intent`, whose getters a subclass doesn't declare itself.
  className?: string;
  // also the getters declared by the superclasses, up to but not including java.lang.Object
  inherited?: boolean;
  // `byte[]` as hex and `char[]` as text, e.g. for IVs, salts and passwords
  compactArrays?: boolean;
}

const DEFAULT_PREFIXES = ["get"];

// getters per `${className}#${prefixes}#${inherited}`
const methodDescriptorCache = new Map<string, JavaMethodDescriptor[]>();
// Like java.beans.Introspector.decapitalize(): `KeySize` -> `keySize`, but `IV` and `URL` stay as they are.
function toPropertyName(name: string): string {
  if (name.length > 1 && name[0] === name[0].toUpperCase() && name[1] === name[1].toUpperCase() && name[1] !== name[1].toLowerCase()) {
    return name;
  }
  return name[0].toLowerCase() + name.slice(1);
}

// The public, non-static, zero-argument methods of `className` (and its superclasses if `inherited`) starting with
// one of `prefixes`, with their property name. A getter declared in a subclass overrides the one of a superclass.
function getPublicNonArgumentMethodNames(JavaClass: Java.Wrapper, className: string, prefixes: string[], inherited: boolean): JavaMethodDescriptor[] {
  const cacheKey = `${className}#${prefixes.join(",")}#${inherited}`;
  const cached = methodDescriptorCache.get(cacheKey);
  if (cached) {
    logger.debug(`Getter cache hit: ${cacheKey}, ${cached.length} getter(s)`);
    return cached;
  }

  const descriptors: JavaMethodDescriptor[] = [];
  const seen = new Set<string>();

  for (let javaClass: Java.Wrapper | null = JavaClass.class; javaClass !== null; javaClass = inherited ? javaClass.getSuperclass() : null) {
    // Object's only getter is getClass(), which every class would repeat
    if (javaClass.getName() === "java.lang.Object" && className !== "java.lang.Object") break;

    const methods = javaClass.getDeclaredMethods();
    for (let i = 0; i < methods.length; i++) {
      const method = methods[i];
      const modifiers: number = method.getModifiers();
      if ((modifiers & MODIFIER_PUBLIC) === 0 || (modifiers & MODIFIER_STATIC) !== 0) continue;
      if (method.getParameterTypes().length !== 0) continue;

      const methodName: string = method.getName();
      if (seen.has(methodName)) continue;
      const prefix = prefixes.find((candidate) => methodName.startsWith(candidate) && methodName.length > candidate.length);
      if (!prefix) continue;
      seen.add(methodName);

      const propertyName = toPropertyName(methodName.slice(prefix.length));
      const returnType: string = method.getReturnType().getName();
      const isPrimitive = JAVA_PRIMITIVE_TYPES.has(returnType) || returnType === "void" || returnType === "java.lang.String";
      const needsUnwrap = returnType === "long" || returnType === "java.lang.String";

      descriptors.push({ methodName, propertyName, returnType, isPrimitive, needsUnwrap });
    }
  }

  methodDescriptorCache.set(cacheKey, descriptors);
  logger.debug(`Getter cache miss: ${cacheKey}, reflected ${descriptors.length} getter(s)`);
  return descriptors;
}

// Calls every matching getter of `instance` and decodes the results with `settings` (the child settings of
// the calling decoder). A getter that throws (hidden API, missing on this API level, ...) is decoded as null.
export function decodeGetterValues(instance: Java.Wrapper, settings: DecoderSettings, options: GetterOptions = {}): DecodedValue[] {
  const className = options.className ?? instance.$className;
  const JavaClass = useClassOf(instance, className);
  const descriptors = getPublicNonArgumentMethodNames(JavaClass, className, options.prefixes ?? DEFAULT_PREFIXES, options.inherited ?? false);
  const values: DecodedValue[] = [];

  // the wrapper can be typed as a supertype without these getters
  const typedInstance = Java.cast(instance, JavaClass);

  for (const { methodName, propertyName, returnType, isPrimitive, needsUnwrap } of descriptors) {
    try {
      const fn: Java.MethodDispatcher = typedInstance[methodName];
      if (typeof fn?.call !== "function") {
        continue;
      }

      const raw = fn.call(typedInstance);
      if (raw === null || raw === undefined) {
        values.push({ type: returnType, name: propertyName, value: null });
      } else if (isPrimitive) {
        values.push({
          type: returnType,
          name: propertyName,
          value: needsUnwrap ? raw.toString() : raw,
        });
      } else if (options.compactArrays && returnType === "[B") {
        values.push({ type: returnType, name: propertyName, value: javaBytesToHex(raw, settings.maxItems) });
      } else if (options.compactArrays && returnType === "[C") {
        values.push(new StringDecoder({ type: returnType, name: propertyName, settings }).decode(raw));
      } else {
        const decodable: Decodable = { type: returnType, name: propertyName, settings };
        values.push(JavaDecoderResolver.resolveDecoder(decodable).decode(raw));
      }
    } catch {
      values.push({ type: "null", name: propertyName, value: null });
    }
  }

  return values;
}
