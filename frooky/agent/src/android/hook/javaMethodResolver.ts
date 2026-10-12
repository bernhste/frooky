import Java from "frida-java-bridge";
import { Param } from "../../shared/decoders/decodable";
import { BaseDecoderSettings } from "../../shared/frookySettings";
import { JavaHookDeclaration } from "../../shared/hook/hookDeclaration";
import { logger } from "../../shared/logger";
import { namePatternToRegExp } from "../../shared/utils";
import { findBlockedMethod, warnBlockedMethod } from "./androidHookValidator";
import { JavaHook } from "./javaHook";

// frida-java-bridge's Method.type of a static method
const STATIC_METHOD = 2;

// null if the method or none of its declared overloads exists in any of `javaClasses`. A `*` in the method name
// matches the methods a class declares itself, not inherited methods or constructors. A method name also finds a
// method the class inherits: its hooks get `inheritedBy`, see inheritingClass().
export function resolveMethodHooks(javaClasses: Java.Wrapper[], inputHook: JavaHookDeclaration): JavaHook[] | null {
  const pattern = inputHook.method.includes("*") ? namePatternToRegExp(inputHook.method) : undefined;
  const classNames = new Set(javaClasses.map((javaClass) => String(javaClass.$className)));
  const hooks: JavaHook[] = [];
  for (const javaClass of javaClasses) {
    try {
      if (!pattern) {
        const method = resolveMethod(javaClass, inputHook);
        const inheritedBy = inheritingClass(javaClass, method, inputHook, classNames);
        if (inheritedBy !== null) hooks.push(...resolveOverloads(method, inputHook, false, javaClass, inheritedBy));
        continue;
      }
      const methodNames = declaredMethodNames(javaClass).filter((name) => pattern.test(name));
      if (methodNames.length === 0) logger.debug(`No method of class '${javaClass.$className}' matches '${inputHook.method}'.`);
      for (const methodName of methodNames) {
        const method: Java.MethodDispatcher | undefined = javaClass[methodName];
        if (method) hooks.push(...resolveOverloads(method, { ...inputHook, method: methodName }, true, javaClass));
      }
    } catch (e) {
      if (inputHook.javaClass.includes("*") && e instanceof Error && e.message.includes("declares no constructors")) {
        logger.debug(e.message);
      } else {
        logger.warn(e instanceof Error ? e.message : String(e));
      }
    }
  }
  return hooks.length > 0 ? hooks : null;
}

// `javaClass` if it inherits `method`: frida-java-bridge finds a method by its name in the superclasses too, as one
// method of the class that declares it, e.g. `put` of `java.util.HashMap` for a subclass. A hook on it runs for the
// calls on every object of the declaring class, so its hooks only record those on instances of `javaClass`.
// Undefined for a method `javaClass` declares itself. Null if there is nothing to hook: the declaring class is hooked
// by the same class pattern (`classNames`), whose hook records these calls already, or the method is static, see
// warnInheritedStatic().
function inheritingClass(
  javaClass: Java.Wrapper,
  method: Java.MethodDispatcher,
  inputHook: JavaHookDeclaration,
  classNames: Set<string>,
): Java.Wrapper | undefined | null {
  const className = String(javaClass.$className);
  const declaringClass = String(method.holder.$className);
  if (declaringClass === className) return undefined;
  if (classNames.has(declaringClass)) {
    logger.debug(`'${className}' inherits '${inputHook.method}' from '${declaringClass}', which is hooked too.`);
    return null;
  }
  if (method.overloads.some((overload) => overload.type === STATIC_METHOD)) {
    warnInheritedStatic(className, inputHook.method, declaringClass);
    return null;
  }
  logger.info(`'${className}' inherits '${inputHook.method}' from '${declaringClass}'. Only the calls on instances of '${className}' are recorded.`);
  return javaClass;
}

// A static method has no instance to tell the calls through a subclass apart by, so a hook on it would record the
// calls through every class.
function warnInheritedStatic(className: string, method: string, declaringClass: string): void {
  logger.warn(
    `Skipping hook for '${method}'. '${className}' inherits this static method from '${declaringClass}': hook it there with 'javaClass: ${declaringClass}'.`,
  );
}

// The overload of `methodName` with `paramTypes` that a superclass of `javaClass` declares. frida-java-bridge only
// lists the overloads of the nearest class that declares the name, e.g. read() and read(byte[], int, int) for
// java.io.BufferedInputStream, but not read(byte[]) of java.io.FilterInputStream.
function findInheritedOverload(javaClass: Java.Wrapper, methodName: string, paramTypes: string[]): Java.Method | undefined {
  const factory: Java.ClassFactory = javaClass.$f;
  for (let superclass = javaClass.class.getSuperclass(); superclass !== null; superclass = superclass.getSuperclass()) {
    try {
      const dispatcher: Java.MethodDispatcher | undefined = factory.use(superclass.getName())[methodName];
      if (dispatcher) return dispatcher.overload(...paramTypes);
    } catch (_) {
      // this superclass doesn't have the overload
    }
  }
  return undefined;
}

// Classes without constructors (interfaces, Kotlin file facades) make Frida fall back to Object.<init>
function hasDeclaredConstructors(javaClass: Java.Wrapper): boolean {
  try {
    return Array.from(javaClass.class?.getDeclaredConstructors?.() ?? []).length > 0;
  } catch {
    return false;
  }
}

// Overloads share a name, so each name once
function declaredMethodNames(javaClass: Java.Wrapper): string[] {
  const methods: Java.Wrapper[] = Array.from(javaClass.class.getDeclaredMethods());
  return [...new Set(methods.map((method) => String(method.getName())))];
}

function buildParamsFromArgumentTypes(argTypes: Java.Type[], decoderSettings: BaseDecoderSettings, declaringClass: string): Param[] {
  return argTypes.reduce((params: Param[], type: Java.Type) => {
    if (type.className) {
      params.push({
        type: type.className,
        direction: "in",
        declaringClass,
        settings: decoderSettings,
      });
    } else {
      logger.warn(`No Frida type name for the VM type ${type.name} found.`);
    }
    return params;
  }, []);
}

function resolveMethod(javaClass: Java.Wrapper, inputHook: JavaHookDeclaration): Java.MethodDispatcher {
  if (inputHook.method === "$init" && !hasDeclaredConstructors(javaClass)) {
    throw Error(`Skipping hook for '$init'. Class '${javaClass.$className}' declares no constructors.`);
  }
  const resolvedMethod = javaClass[inputHook.method];
  if (resolvedMethod) {
    return resolvedMethod;
  } else {
    throw Error(`Skipping hook for '${inputHook.method}'. This method does not exist in class '${javaClass.$className}'.`);
  }
}

// `matched`: the method matched a `*` pattern, which needn't have the declared overloads
// `javaClass`: the class of the hook file; `inheritedBy`: see inheritingClass()
function resolveOverloads(
  method: Java.MethodDispatcher,
  inputHook: JavaHookDeclaration,
  matched: boolean,
  javaClass: Java.Wrapper,
  inheritedBy?: Java.Wrapper,
): JavaHook[] {
  const result: JavaHook[] = [];
  const declaringClass = method.holder.$className;
  // of the params: the class whose constants `decoder: constants` and `decoder: bitmask` use by default
  const hookedClass = String((inheritedBy ?? method.holder).$className);
  // e.g. `$init`, which Frida's method objects name after the class
  const methodName = inputHook.method;
  if (inputHook.overloads?.length) {
    // only the declared overloads
    for (const overload of inputHook.overloads) {
      const params: Param[] = overload.params.map((param) => ({ ...param, declaringClass: hookedClass }));
      const paramTypes: string[] = params.map((param) => param.type);
      const blocked = findBlockedMethod(declaringClass, methodName, paramTypes);
      if (blocked) {
        warnBlockedMethod(declaringClass, methodName, blocked, paramTypes);
        continue;
      }
      let overloadMethod: Java.Method | undefined;
      try {
        overloadMethod = method.overload(...paramTypes);
      } catch (e) {
        // a `*` pattern only matches what the class declares itself
        if (!matched && methodName !== "$init") overloadMethod = findInheritedOverload(javaClass, methodName, paramTypes);
      }
      if (!overloadMethod) {
        (matched ? logger.debug : logger.warn)(`Skipping overload for method '${inputHook.method}(${paramTypes})'. The overload does not exist.`);
        continue;
      }
      const overloadClass = String(overloadMethod.holder.$className);
      const inherited = overloadClass !== String(javaClass.$className);
      if (inherited && overloadClass !== declaringClass) {
        const blockedInherited = findBlockedMethod(overloadClass, methodName, paramTypes);
        if (blockedInherited) {
          warnBlockedMethod(overloadClass, methodName, blockedInherited, paramTypes);
          continue;
        }
        if (overloadMethod.type === STATIC_METHOD) {
          warnInheritedStatic(String(javaClass.$className), `${methodName}(${paramTypes})`, overloadClass);
          continue;
        }
        logger.info(
          `'${javaClass.$className}' inherits '${methodName}(${paramTypes})' from '${overloadClass}'. Only the calls on instances of '${javaClass.$className}' are recorded.`,
        );
      }
      result.push({
        methodName,
        method: overloadMethod,
        inheritedBy: inherited ? (inheritedBy ?? javaClass) : undefined,
        params: inherited ? params.map((param) => ({ ...param, declaringClass: String(javaClass.$className) })) : params,
        hookSettings: inputHook.hookSettings,
        decoderSettings: inputHook.decoderSettings,
        retTypeSettings: overload.returns,
      });
    }
  } else {
    // all overloads
    for (const javaMethod of method.overloads) {
      const paramTypes = javaMethod.argumentTypes.map((type) => type.className ?? type.name);
      const blocked = findBlockedMethod(declaringClass, methodName, paramTypes);
      if (blocked) {
        warnBlockedMethod(declaringClass, methodName, blocked, paramTypes);
        continue;
      }
      const params: Param[] = buildParamsFromArgumentTypes(javaMethod.argumentTypes, inputHook.decoderSettings, hookedClass);
      result.push({
        methodName,
        method: javaMethod,
        inheritedBy,
        params: params,
        hookSettings: inputHook.hookSettings,
        decoderSettings: inputHook.decoderSettings,
      });
    }
  }
  return result;
}
