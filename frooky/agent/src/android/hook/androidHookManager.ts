import Java from "frida-java-bridge";
import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../../shared/decoders/baseDecoder";
import { Param } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS, HOOK_LOOKUP_INTERVAL_MS } from "../../shared/defaultValues";
import { DecoderSettings } from "../../shared/frookySettings";
import { DecodedArgs, HookManager, ParamDecoder } from "../../shared/hook/hookManager";
import { normalizeInputParams } from "../../shared/inputParsing/inputDecodableTypes";
import { InputJavaHookNormalized } from "../../shared/inputParsing/inputJavaHookCollection";
import { logger } from "../../shared/logger";
import { HookStackTrace, PlatformStackTrace } from "../../shared/platformStackTrace";
import { FilterMismatchError, formatHashCode, fromSource, plural, wildcardPatternToRegExp } from "../../shared/utils";
import { JavaDecoderResolver } from "../decoders/javaDecoderResolver";
import { JavaHook } from "./javaHook";
import { JavaHookEvent } from "./javaHookEvent";

let javaSystem: Java.Wrapper | undefined;
function getJavaSystem(): Java.Wrapper {
  return (javaSystem ??= Java.use("java.lang.System"));
}

export type FieldType = {
  fieldType: "static" | "instance";
};

// A registered hook with the decoders it uses on every call
type InstalledJavaHook = {
  hook: JavaHook;
  target: string; // e.g. `java.lang.Integer.reverse`
  inArgDecoders: ParamDecoder<Java.Wrapper>[];
  outArgDecoders: ParamDecoder<Java.Wrapper>[];
  retTypeDecoder?: Decoder<Java.Wrapper>;
};

type HookedOverload = { method: Java.Method; hooks: InstalledJavaHook[] };

// what a hook captured before the original method ran
type JavaHookCall = { installedHook: InstalledJavaHook; stackTrace: HookStackTrace; decodedArgs: DecodedArgs };

// Resolves and installs hooks on Java methods.
export class AndroidHookManager extends HookManager<InputJavaHookNormalized, JavaHook, Java.Wrapper> {
  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    super(JavaDecoderResolver, platformStackTrace, frookyAgent);
  }
  // the hooks installed on an overload, keyed by its ArtMethod handle. Several configs can hook the same overload and
  // each records its own event per call, like several Interceptor listeners on a native function. frida-java-bridge
  // allows one replacement per method and keeps it on the Method wrapper, so one dispatcher per overload runs all of
  // its hooks, and the install and the revert go through the same wrapper.
  private readonly hookedOverloads = new Map<string, HookedOverload>();

  async resolveHooks(inputHooks: InputJavaHookNormalized[], timeout: number, source?: string): Promise<Promise<JavaHook[] | null>[]> {
    logger.info(
      `Resolving ${plural(inputHooks.length, "Java hook")} in ${plural(new Set(inputHooks.map((h) => h.javaClass)).size, "class", "classes")}${fromSource(source)}`,
    );

    // each class is resolved once, no matter how many hooks target it
    const javaClassPromises = new Map<string, Promise<Java.Wrapper[]>>();
    return inputHooks.map(async (inputHook): Promise<JavaHook[] | null> => {
      let javaClassesPromise = javaClassPromises.get(inputHook.javaClass);
      if (javaClassesPromise) {
        logger.debug(`Class lookup cache hit: ${inputHook.javaClass} (for ${inputHook.javaClass}.${inputHook.method})`);
      } else {
        logger.debug(`Class lookup cache miss: ${inputHook.javaClass} (for ${inputHook.javaClass}.${inputHook.method})`);
        javaClassesPromise = this.resolveJavaClass(inputHook.javaClass, timeout).catch((e) => {
          logger.warn(e instanceof Error ? e.message : String(e));
          return [] as Java.Wrapper[];
        });
        javaClassPromises.set(inputHook.javaClass, javaClassesPromise);
      }
      const resolvedJavaClasses = await javaClassesPromise;
      if (resolvedJavaClasses.length === 0) return null;

      const hooks: JavaHook[] = [];
      for (const resolvedJavaClass of resolvedJavaClasses) {
        try {
          const method = this.resolveMethod(resolvedJavaClass, inputHook);
          hooks.push(...this.resolveOverloads(method, inputHook));
        } catch (e) {
          logger.warn(e instanceof Error ? e.message : String(e));
        }
      }
      return hooks.length > 0 ? hooks : null;
    });
  }

  registerHooks(hooks: JavaHook[], source?: string): number {
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      const target = `${hook.method.holder.$className}.${hook.methodName}`;
      const installedHook = this.prepareHook(hook, target);

      const key = hook.method.handle.toString();
      let overload = this.hookedOverloads.get(key);
      if (!overload) {
        const newOverload: HookedOverload = { method: hook.method, hooks: [] };
        try {
          newOverload.method.implementation = this.createDispatcher(newOverload);
        } catch (e) {
          logger.warn(`Failed to hook ${target}: ${e}`);
          continue;
        }
        overload = newOverload;
        this.hookedOverloads.set(key, overload);
      }
      // copied on write: a call in progress keeps running the hooks it started with
      overload.hooks = [...overload.hooks, installedHook];
      logger.info(`Hooked ${target}(${hook.method.argumentTypes.map((t) => t.className ?? t.name).join(", ")})${fromSource(source)}`);

      countSuccessfulHooks++;
    }
    return countSuccessfulHooks;
  }

  unregisterHooks(hooks: JavaHook[]): void {
    for (const hook of hooks) {
      const key = hook.method.handle.toString();
      const overload = this.hookedOverloads.get(key);
      const index = overload ? overload.hooks.findIndex((installedHook) => installedHook.hook === hook) : -1;
      if (!overload || index < 0) continue;

      overload.hooks = overload.hooks.filter((_, i) => i !== index);
      if (overload.hooks.length > 0) continue;

      this.hookedOverloads.delete(key);
      try {
        // null reverts the method to its original implementation
        overload.method.implementation = null;
      } catch (e) {
        logger.warn(`Failed to unhook ${hook.method.holder.$className}.${hook.methodName}: ${e}`);
      }
    }
  }

  // resolves the decoders once per hook, not per call
  private prepareHook(hook: JavaHook, target: string): InstalledJavaHook {
    let inArgDecoders: ParamDecoder<Java.Wrapper>[] = [];
    let outArgDecoders: ParamDecoder<Java.Wrapper>[] = [];
    if (hook.params) {
      const argDecoders = this.resolveParamDecoders(hook.params);
      inArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "in" || argDecoder.direction === "inout");
      outArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "out" || argDecoder.direction === "inout");
    }
    let retTypeDecoder: Decoder<Java.Wrapper> | undefined;
    if (hook.method.returnType.className) {
      retTypeDecoder = this.resolveRetTypeDecoder({
        type: hook.method.returnType.className,
        declaringClass: hook.method.holder.$className,
        settings: hook.retTypeSettings ?? hook.decoderSettings,
      });
    }
    return { hook, target, inArgDecoders, outArgDecoders, retTypeDecoder };
  }

  // Replaces the overload: every hook decodes its `in` args, the original method runs once, then every hook that
  // passed its filters decodes its `out` args and return value and logs its event.
  private createDispatcher(overload: HookedOverload): Java.MethodImplementation {
    const hookManager = this;
    return function (this: Java.Wrapper, ...args: Java.Wrapper[]) {
      const calls: JavaHookCall[] = [];
      for (const installedHook of overload.hooks) {
        const call = hookManager.enterHook(installedHook, args);
        if (call) calls.push(call);
      }

      let returnValue;
      try {
        returnValue = overload.method.apply(this, args);
      } catch (e) {
        logger.error(`Error during execution of hooked method: ${e}`);
        throw e; // the app handles its own exception
      }

      for (const call of calls) {
        hookManager.leaveHook(call, this, args, returnValue);
      }
      return returnValue;
    };
  }

  // null if the stackTraceFilter or an argFilter doesn't match, or decoding fails
  private enterHook(installedHook: InstalledJavaHook, args: Java.Wrapper[]): JavaHookCall | null {
    const { hook, target, inArgDecoders } = installedHook;
    let stackTrace: HookStackTrace;
    try {
      stackTrace = this.stackTrace.build(hook.hookSettings);
    } catch (e) {
      if (!(e instanceof FilterMismatchError)) {
        logger.error(`Failed to build the stack trace of ${target}: ${e}`);
      }
      return null;
    }

    const decodedArgs: DecodedArgs = { in: [], out: [] };
    if (inArgDecoders.length > 0) {
      try {
        decodedArgs.in = this.decodeArgs(args, inArgDecoders, target);
      } catch (e) {
        if (!(e instanceof FilterMismatchError)) {
          logger.error(`Decoder error during 'onEnter' argument decoding of ${target}: ${e}`);
        }
        return null;
      }
    }
    return { installedHook, stackTrace, decodedArgs };
  }

  private leaveHook(call: JavaHookCall, instance: Java.Wrapper, args: Java.Wrapper[], returnValue: any): void {
    const { hook, target, outArgDecoders, retTypeDecoder } = call.installedHook;
    const { decodedArgs } = call;
    // first, as `out` parameters with `decoderArg: $ret` need it
    let decodedRetValue: DecodedValue | undefined;
    if (retTypeDecoder) {
      try {
        decodedRetValue = this.decodeValue(retTypeDecoder, returnValue, `${target} return value`);
      } catch (e) {
        logger.error(`Decoder error during return value decoding of ${target}: ${e}`);
        return;
      }
    }

    if (outArgDecoders.length > 0) {
      try {
        decodedArgs.out = this.decodeArgs(args, outArgDecoders, target, decodedRetValue);
      } catch (e) {
        if (!(e instanceof FilterMismatchError)) {
          logger.error(`Decoder error during 'onLeave' argument decoding of ${target}: ${e}`);
        }
        return;
      }
    }

    const fieldType = this.buildFieldType(instance);
    // identityHashCode() runs no app code, unlike an overridden hashCode(), and stays the same while the object mutates
    const hashCode = fieldType.fieldType === "instance" ? formatHashCode(getJavaSystem().identityHashCode(instance)) : undefined;
    this.frookyAgent.addEventToLog(new JavaHookEvent(hook, fieldType, hashCode, decodedArgs, decodedRetValue, call.stackTrace));
  }

  private buildParamsFromArgumentTypes(argTypes: Java.Type[], decoderSettings: DecoderSettings, declaringClass: string): Param[] {
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

  // Polls until the class is loaded, or for a wildcard pattern (e.g. `org.owasp.*.HttpClient`, `*` matching
  // one package or class segment) until at least one loaded class matches. Throws on timeout.
  private async resolveJavaClass(javaClassName: string, timeoutSeconds: number): Promise<Java.Wrapper[]> {
    logger.debug(`Resolving java class ${javaClassName} with a timeout of ${timeoutSeconds} seconds.`);

    if (javaClassName.includes("*")) {
      const pattern = wildcardPatternToRegExp(javaClassName);
      return this.pollUntilResolved(
        () => {
          const resolvedClasses = this.resolveMatchingJavaClasses(pattern);
          if (resolvedClasses.length === 0) return null;
          logger.debug(`${resolvedClasses.length} Java class(es) matching wildcard pattern '${javaClassName}' resolved.`);
          return resolvedClasses;
        },
        `Java class matching '${javaClassName}'`,
        timeoutSeconds,
      );
    }

    return this.pollUntilResolved(
      () => {
        try {
          const resolvedJavaClass = Java.use(javaClassName);
          logger.debug(`Java class '${javaClassName}' resolved.`);
          return [resolvedJavaClass];
        } catch (_) {
          return null;
        }
      },
      `Java class '${javaClassName}'`,
      timeoutSeconds,
    );
  }

  private resolveMatchingJavaClasses(pattern: RegExp): Java.Wrapper[] {
    const resolvedClasses: Java.Wrapper[] = [];
    for (const className of AndroidHookManager.getLoadedClassNames()) {
      if (!pattern.test(className)) continue;
      try {
        resolvedClasses.push(Java.use(className));
      } catch (e) {
        logger.debug(`Failed to resolve matched Java class '${className}': ${e}`);
      }
    }
    return resolvedClasses;
  }

  // Java.enumerateLoadedClassesSync() can take hundreds of ms, so all wildcard lookups of one poll interval
  // share its result.
  private static getLoadedClassNames(): string[] {
    const now = Date.now();
    if (!this.loadedClassNamesCache || now >= this.loadedClassNamesCache.expiresAt) {
      this.loadedClassNamesCache = { names: Java.enumerateLoadedClassesSync(), expiresAt: now + HOOK_LOOKUP_INTERVAL_MS };
      logger.debug(`Loaded class list cache miss: enumerated ${this.loadedClassNamesCache.names.length} loaded classes`);
    } else {
      logger.debug(`Loaded class list cache hit: ${this.loadedClassNamesCache.names.length} loaded classes`);
    }
    return this.loadedClassNamesCache.names;
  }

  private static loadedClassNamesCache: { names: string[]; expiresAt: number } | null = null;

  private resolveMethod(javaClass: Java.Wrapper, inputHook: InputJavaHookNormalized): Java.MethodDispatcher {
    const resolvedMethod = javaClass[inputHook.method];
    if (resolvedMethod) {
      return resolvedMethod;
    } else {
      throw Error(`Skipping hook for '${inputHook.method}'. This method does not exist in class '${javaClass.$className}'.`);
    }
  }

  private resolveOverloads(method: Java.MethodDispatcher, inputHook: InputJavaHookNormalized): JavaHook[] {
    const result: JavaHook[] = [];
    const declaringClass = method.holder.$className;
    if (inputHook.overloads?.length) {
      // only the declared overloads
      for (const overload of inputHook.overloads) {
        const normalizedParams: Param[] = normalizeInputParams(overload.params).map((param: Param) => ({ ...param, declaringClass }));
        const paramTypes: string[] = normalizedParams.map((param: Param) => param.type);
        try {
          result.push({
            methodName: method.methodName,
            method: method.overload(...paramTypes),
            params: normalizedParams,
            hookSettings: inputHook.hookSettings ?? DEFAULT_HOOK_SETTINGS,
            decoderSettings: inputHook.decoderSettings ?? DEFAULT_DECODER_SETTINGS,
            retTypeSettings: overload.retType as DecoderSettings | undefined,
          });
        } catch (e) {
          logger.warn(`Skipping overload for method '${inputHook.method}(${paramTypes})'. The overload does not exist.`);
        }
      }
    } else {
      // all overloads
      for (const javaMethod of method.overloads) {
        const params: Param[] = this.buildParamsFromArgumentTypes(javaMethod.argumentTypes, inputHook.decoderSettings!, declaringClass);
        result.push({
          methodName: method.methodName,
          method: javaMethod,
          params: params,
          hookSettings: inputHook.hookSettings ?? DEFAULT_HOOK_SETTINGS,
          decoderSettings: inputHook.decoderSettings ?? DEFAULT_DECODER_SETTINGS,
        });
      }
    }
    return result;
  }

  private buildFieldType(instance: Java.Wrapper): FieldType {
    // `this` of a static method is the class wrapper, which has no object handle
    return { fieldType: instance?.$h == null ? "static" : "instance" };
  }
}
