import Java from "frida-java-bridge";
import { Decodable } from "../../../shared/decoders/decodable";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../../shared/frookySettings";
import { JAVA_PRIMITIVE_TYPES, JavaDecoderResolver } from "../javaDecoderResolver";
import { logger } from "../../../shared/logger";

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

// getters per `${className}#${prefixes}`
const methodDescriptorCache = new Map<string, JavaMethodDescriptor[]>();
const classWrapperCache = new Map<string, Java.Wrapper>();

function getJavaClass(className: string): Java.Wrapper {
  let cls = classWrapperCache.get(className);
  if (!cls) {
    cls = Java.use(className);
    classWrapperCache.set(className, cls);
  }
  return cls;
}

// The public, non-static, zero-argument methods of `className` starting with one of `prefixes`, with their
// property name, e.g. `["get", "is"]`: `getKeySize` -> `keySize`, `isEnabled` -> `enabled`.
function getPublicNonArgumentMethodNames(className: string, prefixes: string[]): JavaMethodDescriptor[] {
  const cacheKey = `${className}#${prefixes.join(",")}`;
  const cached = methodDescriptorCache.get(cacheKey);
  if (cached) {
    logger.debug(`Getter cache hit: ${cacheKey}, ${cached.length} getter(s)`);
    return cached;
  }

  const JavaClass = getJavaClass(className);
  const methods = JavaClass.class.getDeclaredMethods();
  const descriptors: JavaMethodDescriptor[] = [];

  for (let i = 0; i < methods.length; i++) {
    const method = methods[i];
    const modifiers: number = method.getModifiers();
    if ((modifiers & MODIFIER_PUBLIC) === 0 || (modifiers & MODIFIER_STATIC) !== 0) continue;
    if (method.getParameterTypes().length !== 0) continue;

    const methodName: string = method.getName();
    const prefix = prefixes.find((candidate) => methodName.startsWith(candidate) && methodName.length > candidate.length);
    if (!prefix) continue;

    const propertyName = methodName[prefix.length].toLowerCase() + methodName.slice(prefix.length + 1);
    const returnType: string = method.getReturnType().getName();
    const isPrimitive = JAVA_PRIMITIVE_TYPES.has(returnType) || returnType === "void" || returnType === "java.lang.String";
    const needsUnwrap = returnType === "long" || returnType === "java.lang.String";

    descriptors.push({ methodName, propertyName, returnType, isPrimitive, needsUnwrap });
  }

  methodDescriptorCache.set(cacheKey, descriptors);
  logger.debug(`Getter cache miss: ${cacheKey}, reflected ${descriptors.length} getter(s)`);
  return descriptors;
}

// Calls every matching getter of `instance` and decodes the results with `settings` (the child settings of
// the calling decoder). A getter that throws (hidden API, missing on this API level, ...) is decoded as null.
export function decodeGetterValues(instance: Java.Wrapper, prefixes: string[], settings: DecoderSettings): DecodedValue[] {
  const className = instance.$className;
  const descriptors = getPublicNonArgumentMethodNames(className, prefixes);
  const values: DecodedValue[] = [];

  // the wrapper can be typed as a supertype without these getters
  const JavaClass = getJavaClass(className);
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
