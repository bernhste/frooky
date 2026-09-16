import Java from "frida-java-bridge";
import { Decodable } from "../../../shared/decoders/decodable";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../../shared/frookySettings";
import { JavaDecoderResolver } from "../javaDecoderResolver";

// java.lang.reflect.Modifier bit values (stable since Java 1.1), avoids a Java.use() just for these
const MODIFIER_PUBLIC = 0x1;
const MODIFIER_STATIC = 0x8;

type JavaMethodDescriptor = { methodName: string; propertyName: string };

// Keyed by `${className}#${prefixes}` since a class's declared methods never change at runtime, so
// the matching method names are reflected once and shared across every decode call that requests
// the same class/prefixes combination.
const methodDescriptorCache = new Map<string, JavaMethodDescriptor[]>();

/**
 * Reflects the names of `className`'s public, non-static, zero-argument methods (getters like
 * `getName()`, `isEnabled()` - never a method that takes arguments) whose name starts with one of
 * `prefixes` (e.g. `["get", "is"]`). The matched prefix is always removed and the next character
 * lowercased to produce a property-style name (e.g. "getKeySize" -> "keySize").
 */
function getPublicNonArgumentMethodNames(className: string, prefixes: string[]): JavaMethodDescriptor[] {
  const cacheKey = `${className}#${prefixes.join(",")}`;
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

    const propertyName = methodName[prefix.length].toLowerCase() + methodName.slice(prefix.length + 1);
    descriptors.push({ methodName, propertyName });
  }

  methodDescriptorCache.set(cacheKey, descriptors);
  return descriptors;
}

/**
 * Invokes every matching getter on `instance`'s runtime class, decoding each return value with
 * {@link JavaDecoderResolver} under its prefix-stripped property name. `instance` is re-cast to its
 * own runtime class first since its existing JS dispatcher table can be narrower than `$className`
 * (e.g. a declared supertype), which would otherwise resolve every lookup below to `undefined`. A
 * getter can still fail to invoke (unset property, hidden-API policy, missing on this API level) -
 * every such failure is decoded as `null` for that property rather than aborting the whole call.
 */
export function decodeGetterValues(instance: Java.Wrapper, prefixes: string[], settings: DecoderSettings): DecodedValue[] {
  const descriptors = getPublicNonArgumentMethodNames(instance.$className, prefixes);
  const values: DecodedValue[] = [];

  const typedInstance = Java.cast(instance, Java.use(instance.$className));

  for (const { methodName, propertyName } of descriptors) {
    try {
      const fn: Java.MethodDispatcher = typedInstance[methodName];
      if (typeof fn?.call !== "function") {
        continue;
      }

      const raw = fn.call(typedInstance);
      const decodable: Decodable = { type: fn.returnType.className ?? "void", name: propertyName, settings };
      values.push(JavaDecoderResolver.resolveDecoder(decodable).decode(raw));
    } catch {
      values.push({ type: "null", name: propertyName, value: null });
    }
  }

  return values;
}
