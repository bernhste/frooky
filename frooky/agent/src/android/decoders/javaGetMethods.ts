import Java from "frida-java-bridge";
import { Decodable } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../shared/frookySettings";
import { JavaDecoderResolver } from "./javaDecoderResolver";

// java.lang.reflect.Modifier bit values (stable since Java 1.1), avoids a Java.use() just for these
const MODIFIER_PUBLIC = 0x1;
const MODIFIER_STATIC = 0x8;

export type JavaMethodDescriptor = { methodName: string; propertyName: string };

// Keyed by `${className}#${prefixes}#${stripPrefix}` since a class's declared methods never change
// at runtime, so the matching method names are reflected once and shared across every decode call
// that requests the same class/prefixes/stripPrefix combination.
const methodDescriptorCache = new Map<string, JavaMethodDescriptor[]>();

/**
 * Reflects the names of `className`'s public, non-static, zero-argument methods whose name starts
 * with one of `prefixes` (e.g. `["get", "is"]`). When `stripPrefix` is true, the matched prefix is
 * removed and the next character lowercased to produce a property-style name (e.g. "getKeySize" ->
 * "keySize"); otherwise `propertyName` is the same as `methodName`.
 */
export function loadPublicMethodNames(className: string, prefixes: string[], stripPrefix = false): JavaMethodDescriptor[] {
  const cacheKey = `${className}#${prefixes.join(",")}#${stripPrefix}`;
  const cached = methodDescriptorCache.get(cacheKey);
  if (cached) return cached;

  const JavaClass = Java.use(className);
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

    const propertyName = stripPrefix ? methodName[prefix.length].toLowerCase() + methodName.slice(prefix.length + 1) : methodName;
    descriptors.push({ methodName, propertyName });
  }

  methodDescriptorCache.set(cacheKey, descriptors);
  return descriptors;
}

/**
 * Invokes every public, non-static, zero-argument method of `instance` (an object of type
 * `className`) whose name starts with one of `prefixes`, decoding each return value with
 * {@link JavaDecoderResolver}. A method reflected here can still fail to invoke for reasons outside
 * the caller's control - it throws because the underlying property was never set (common on
 * spec/builder-style classes), it's a `@hide`/restricted API blocked by the device's hidden-API
 * policy, or it simply isn't present on this API level - so every failure mode, including resolving
 * `instance[methodName]` itself, is decoded as `null` for that one property rather than aborting
 * the whole call.
 */
export function decodePublicMethodValues(
  instance: Java.Wrapper,
  className: string,
  prefixes: string[],
  settings: DecoderSettings,
  stripPrefix = false,
): DecodedValue[] {
  const descriptors = loadPublicMethodNames(className, prefixes, stripPrefix);
  const values: DecodedValue[] = [];

  for (const { methodName, propertyName } of descriptors) {
    try {
      const fn: Java.MethodDispatcher = instance[methodName];
      if (typeof fn?.call !== "function") {
        continue;
      }

      const raw = fn.call(instance);
      const decodable: Decodable = { type: fn.returnType.className ?? "void", name: propertyName, settings };
      values.push(JavaDecoderResolver.resolveDecoder(decodable).decode(raw));
    } catch {
      values.push({ type: "null", name: propertyName, value: null });
    }
  }

  return values;
}
