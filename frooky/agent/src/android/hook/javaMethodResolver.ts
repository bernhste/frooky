import Java from "frida-java-bridge";
import { Param } from "../../shared/decoders/decodable";
import { BaseDecoderSettings } from "../../shared/frookySettings";
import { JavaHookDeclaration } from "../../shared/hook/hookDeclaration";
import { logger } from "../../shared/logger";
import { namePatternToRegExp } from "../../shared/utils";
import { findBlockedMethod, warnBlockedMethod } from "./androidHookValidator";
import { JavaHook } from "./javaHook";

// null if the method or none of its declared overloads exists in any of `javaClasses`. A `*` in the method name
// matches the methods a class declares itself, not inherited methods or constructors.
export function resolveMethodHooks(javaClasses: Java.Wrapper[], inputHook: JavaHookDeclaration): JavaHook[] | null {
  const pattern = inputHook.method.includes("*") ? namePatternToRegExp(inputHook.method) : undefined;
  const hooks: JavaHook[] = [];
  for (const javaClass of javaClasses) {
    try {
      if (!pattern) {
        hooks.push(...resolveOverloads(resolveMethod(javaClass, inputHook), inputHook));
        continue;
      }
      const methodNames = declaredMethodNames(javaClass).filter((name) => pattern.test(name));
      if (methodNames.length === 0) logger.debug(`No method of class '${javaClass.$className}' matches '${inputHook.method}'.`);
      for (const methodName of methodNames) {
        const method: Java.MethodDispatcher | undefined = javaClass[methodName];
        if (method) hooks.push(...resolveOverloads(method, { ...inputHook, method: methodName }, true));
      }
    } catch (e) {
      logger.warn(e instanceof Error ? e.message : String(e));
    }
  }
  return hooks.length > 0 ? hooks : null;
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
  const resolvedMethod = javaClass[inputHook.method];
  if (resolvedMethod) {
    return resolvedMethod;
  } else {
    throw Error(`Skipping hook for '${inputHook.method}'. This method does not exist in class '${javaClass.$className}'.`);
  }
}

// `matched`: the method matched a `*` pattern, which needn't have the declared overloads
function resolveOverloads(method: Java.MethodDispatcher, inputHook: JavaHookDeclaration, matched = false): JavaHook[] {
  const result: JavaHook[] = [];
  const declaringClass = method.holder.$className;
  // e.g. `$init`, which Frida's method objects name after the class
  const methodName = inputHook.method;
  if (inputHook.overloads?.length) {
    // only the declared overloads
    for (const overload of inputHook.overloads) {
      const params: Param[] = overload.params.map((param) => ({ ...param, declaringClass }));
      const paramTypes: string[] = params.map((param) => param.type);
      const blocked = findBlockedMethod(declaringClass, methodName, paramTypes);
      if (blocked) {
        warnBlockedMethod(declaringClass, methodName, blocked, paramTypes);
        continue;
      }
      try {
        result.push({
          methodName,
          method: method.overload(...paramTypes),
          params,
          hookSettings: inputHook.hookSettings,
          decoderSettings: inputHook.decoderSettings,
          retTypeSettings: overload.retType,
        });
      } catch (e) {
        (matched ? logger.debug : logger.warn)(`Skipping overload for method '${inputHook.method}(${paramTypes})'. The overload does not exist.`);
      }
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
      const params: Param[] = buildParamsFromArgumentTypes(javaMethod.argumentTypes, inputHook.decoderSettings, declaringClass);
      result.push({
        methodName,
        method: javaMethod,
        params: params,
        hookSettings: inputHook.hookSettings,
        decoderSettings: inputHook.decoderSettings,
      });
    }
  }
  return result;
}
