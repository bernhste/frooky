import Java from "frida-java-bridge";

export type JavaIntConstant = { name: string; value: number };

// Keyed by `${className}#${prefix}` since declared constants never change at runtime, so results
// are reflected once and shared across every decoder instance that requests the same class/prefix
// instead of re-walking the class's declared fields per hook.
const constantCache = new Map<string, JavaIntConstant[]>();

/**
 * Reflects all `public static int` fields of `className` whose name starts with `prefix`
 * (e.g. Intent's `FLAG_*` or `URI_*` constants).
 */
export function loadJavaIntConstants(className: string, prefix: string): JavaIntConstant[] {
  const cacheKey = `${className}#${prefix}`;
  const cached = constantCache.get(cacheKey);
  if (cached) return cached;

  const JavaClass = Java.use(className);
  const fields = JavaClass.class.getDeclaredFields();
  const constants: JavaIntConstant[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const name: string = f.getName();
    if (!name.startsWith(prefix)) continue;
    if (f.getType().getName() !== "int") continue;
    f.setAccessible(true);
    constants.push({ name, value: f.getInt(null) >>> 0 });
  }

  constantCache.set(cacheKey, constants);
  return constants;
}
