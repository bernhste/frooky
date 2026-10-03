import Java from "frida-java-bridge";
import { Param } from "../../shared/decoders/decodable";
import { DecoderSettings } from "../../shared/frookySettings";
import { JavaHookDeclaration } from "../../shared/hook/hookDeclaration";
import { logger } from "../../shared/logger";
import { JavaHook } from "./javaHook";

// null if the method or none of its declared overloads exists in any of `javaClasses`
export function resolveMethodHooks(javaClasses: Java.Wrapper[], inputHook: JavaHookDeclaration): JavaHook[] | null {
  const hooks: JavaHook[] = [];
  for (const javaClass of javaClasses) {
    try {
      const method = resolveMethod(javaClass, inputHook);
      hooks.push(...resolveOverloads(method, inputHook));
    } catch (e) {
      logger.warn(e instanceof Error ? e.message : String(e));
    }
  }
  return hooks.length > 0 ? hooks : null;
}

function buildParamsFromArgumentTypes(argTypes: Java.Type[], decoderSettings: DecoderSettings, declaringClass: string): Param[] {
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

function resolveOverloads(method: Java.MethodDispatcher, inputHook: JavaHookDeclaration): JavaHook[] {
  const result: JavaHook[] = [];
  const declaringClass = method.holder.$className;
  if (inputHook.overloads?.length) {
    // only the declared overloads
    for (const overload of inputHook.overloads) {
      const params: Param[] = overload.params.map((param) => ({ ...param, declaringClass }));
      const paramTypes: string[] = params.map((param) => param.type);
      try {
        result.push({
          methodName: method.methodName,
          method: method.overload(...paramTypes),
          params,
          hookSettings: inputHook.hookSettings,
          decoderSettings: inputHook.decoderSettings,
          retTypeSettings: overload.retType,
        });
      } catch (e) {
        logger.warn(`Skipping overload for method '${inputHook.method}(${paramTypes})'. The overload does not exist.`);
      }
    }
  } else {
    // all overloads
    for (const javaMethod of method.overloads) {
      const params: Param[] = buildParamsFromArgumentTypes(javaMethod.argumentTypes, inputHook.decoderSettings, declaringClass);
      result.push({
        methodName: method.methodName,
        method: javaMethod,
        params: params,
        hookSettings: inputHook.hookSettings,
        decoderSettings: inputHook.decoderSettings,
      });
    }
  }
  return result;
}
