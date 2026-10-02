import Java from "frida-java-bridge";
import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../../shared/decoders/baseDecoder";
import { Param } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { DecoderSettings } from "../../shared/frookySettings";
import { enterHookCode, leaveHookCode } from "../../shared/hook/hookCodeGuard";
import { DecodedArgs, HookManager, ParamDecoder } from "../../shared/hook/hookManager";
import { normalizeInputParams } from "../../shared/inputParsing/inputDecodableTypes";
import { InputJavaHookNormalized } from "../../shared/inputParsing/inputJavaHookCollection";
import { logger } from "../../shared/logger";
import { HookStackTrace, needsStackTrace, PlatformStackTrace, UnsafeContext } from "../../shared/platformStackTrace";
import { FilterMismatchError, formatHashCode, fromSource, plural } from "../../shared/utils";
import { detectUnsafeContext } from "../../native/unsafeContext";
import { JavaDecoderResolver } from "../decoders/javaDecoderResolver";
import { JavaHook } from "./javaHook";
import { JavaClassResolver, MethodObserver } from "./javaClassResolver";
import { JavaHookEvent } from "./javaHookEvent";

let javaSystem: Java.Wrapper | undefined;
function getJavaSystem(): Java.Wrapper {
  return (javaSystem ??= Java.use("java.lang.System"));
}

// frida-java-bridge looks up Class.isAssignableFrom() and Class.isInstance() of a ClassFactory when it first converts
// a value of an object type, e.g. the return value of an original method. The lookup calls
// Method.getGenericReturnType(), which ART builds with StringBuilder: with StringBuilder hooked, the conversion runs
// the hook again before the lookup finishes, until the stack overflows. Done before the factory's first hook instead.
function resolveClassMembers(factory: Java.ClassFactory): void {
  const stringClass = factory.use("java.lang.String").class;
  stringClass.isAssignableFrom(stringClass);
  stringClass.isInstance(null);
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
  needsStackTrace: boolean;
};

// `observers` run after the original method, e.g. JavaClassResolver's on new class loaders
type HookedOverload = { method: Java.Method; hooks: InstalledJavaHook[]; observers: MethodObserver[] };

// what a hook captured before the original method ran
// `logTarget`: see callLogTarget()
type JavaHookCall = { installedHook: InstalledJavaHook; logTarget: string; stackTrace: HookStackTrace; decodedArgs: DecodedArgs };

// Resolves and installs hooks on Java methods.
export class AndroidHookManager extends HookManager<InputJavaHookNormalized, JavaHook, Java.Wrapper> {
  private readonly classResolver: JavaClassResolver;

  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    super(JavaDecoderResolver, platformStackTrace, frookyAgent);
    this.classResolver = new JavaClassResolver(
      (method, observer) => this.observe(method, observer),
      () => Promise.resolve(this.frookyAgent.targetReady),
    );
  }
  // the hooks installed on an overload, keyed by its ArtMethod handle. Several configs can hook the same overload and
  // each records its own event per call, like several Interceptor listeners on a native function. frida-java-bridge
  // allows one replacement per method and keeps it on the Method wrapper, so one dispatcher per overload runs all of
  // its hooks, and the install and the revert go through the same wrapper.
  private readonly hookedOverloads = new Map<string, HookedOverload>();
  // the ClassFactory of every hooked class, see resolveClassMembers()
  private readonly preparedFactories = new Set<Java.ClassFactory>();

  // A hook on a class that isn't found yet is installed as soon as a class loader has it, before its code runs,
  // see JavaClassResolver. resolveHooks() resolves its promise afterwards, see registerHooks().
  async resolveHooks(inputHooks: InputJavaHookNormalized[], source?: string): Promise<Promise<JavaHook[] | null>[]> {
    logger.info(
      `Resolving ${plural(inputHooks.length, "Java hook")} in ${plural(new Set(inputHooks.map((h) => h.javaClass)).size, "class", "classes")}${fromSource(source)}`,
    );

    // each class is looked up once, no matter how many hooks target it
    const hookIndicesByClass = new Map<string, number[]>();
    inputHooks.forEach((inputHook, i) => {
      const key = `${inputHook.javaClass} ${inputHook.classLoader ?? ""}`;
      hookIndicesByClass.set(key, [...(hookIndicesByClass.get(key) ?? []), i]);
    });

    const results: Promise<JavaHook[] | null>[] = new Array(inputHooks.length);
    for (const hookIndices of hookIndicesByClass.values()) {
      const { javaClass, classLoader } = inputHooks[hookIndices[0]];
      const classHooks = this.classResolver.find(javaClass, classLoader, (javaClasses, installNow) =>
        hookIndices.map((i) => {
          const hooks = this.resolveMethodHooks(javaClasses, inputHooks[i]);
          if (hooks && installNow) this.registerHooks(hooks, source);
          return hooks;
        }),
      );
      hookIndices.forEach((hookIndex, j) => (results[hookIndex] = classHooks.then((hooks) => hooks[j])));
    }
    return results;
  }

  // null if the method or none of its declared overloads exists in any of `javaClasses`
  private resolveMethodHooks(javaClasses: Java.Wrapper[], inputHook: InputJavaHookNormalized): JavaHook[] | null {
    const hooks: JavaHook[] = [];
    for (const javaClass of javaClasses) {
      try {
        const method = this.resolveMethod(javaClass, inputHook);
        hooks.push(...this.resolveOverloads(method, inputHook));
      } catch (e) {
        logger.warn(e instanceof Error ? e.message : String(e));
      }
    }
    return hooks.length > 0 ? hooks : null;
  }

  // Runs `observer` after every call of `method`, next to the hooks installed on it
  observe(method: Java.Method, observer: MethodObserver): void {
    const overload = this.hookedOverload(method);
    overload.observers = [...overload.observers, observer];
  }

  // The HookedOverload of `method`, created and installed on first use. Throws if the method can't be hooked.
  private hookedOverload(method: Java.Method): HookedOverload {
    const key = method.handle.toString();
    let overload = this.hookedOverloads.get(key);
    if (!overload) {
      const factory: Java.ClassFactory = method.holder.$f;
      if (!this.preparedFactories.has(factory)) {
        resolveClassMembers(factory);
        this.preparedFactories.add(factory);
      }
      const newOverload: HookedOverload = { method, hooks: [], observers: [] };
      newOverload.method.implementation = this.createDispatcher(newOverload);
      overload = newOverload;
      this.hookedOverloads.set(key, overload);
    }
    return overload;
  }

  registerHooks(hooks: JavaHook[], source?: string): number {
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      if (this.hookedOverloads.get(hook.method.handle.toString())?.hooks.some((installedHook) => installedHook.hook === hook)) {
        countSuccessfulHooks++;
        continue;
      }
      const target = `${hook.method.holder.$className}.${hook.methodName}`;
      const installedHook = this.prepareHook(hook, target);

      let overload: HookedOverload;
      try {
        overload = this.hookedOverload(hook.method);
      } catch (e) {
        logger.warn(`Failed to hook ${target}: ${e}`);
        continue;
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
      if (overload.hooks.length > 0 || overload.observers.length > 0) continue;

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
    return { hook, target, inArgDecoders, outArgDecoders, retTypeDecoder, needsStackTrace: needsStackTrace(hook.hookSettings) };
  }

  // Replaces the overload: every hook decodes its `in` args, the original method runs once, then every hook that
  // passed its filters decodes its `out` args and return value and logs its event. A call made by hook code
  // (see hookCodeGuard.ts) only runs the original method and the observers.
  private createDispatcher(overload: HookedOverload): Java.MethodImplementation {
    const hookManager = this;
    return function (this: Java.Wrapper, ...args: Java.Wrapper[]) {
      const enterTid = enterHookCode();
      if (enterTid === undefined) {
        const returnValue = overload.method.apply(this, args);
        hookManager.runObservers(overload, this, args, returnValue);
        return returnValue;
      }
      const calls: JavaHookCall[] = [];
      try {
        const hooks = overload.hooks;
        const unsafeContext = hooks.some((installedHook) => installedHook.needsStackTrace) ? detectUnsafeContext() : undefined;
        for (const installedHook of hooks) {
          const call = hookManager.enterHook(installedHook, args, unsafeContext);
          if (call) calls.push(call);
        }
      } finally {
        leaveHookCode(enterTid);
      }

      let returnValue;
      try {
        returnValue = overload.method.apply(this, args);
      } catch (e) {
        // observed methods such as ClassLoader.loadClass() throw as part of their normal work
        if (overload.hooks.length > 0) logger.error(`Error during execution of hooked method: ${e}`);
        throw e; // the app handles its own exception
      }

      const leaveTid = enterHookCode();
      if (leaveTid === undefined) return returnValue;
      try {
        hookManager.runObservers(overload, this, args, returnValue);
        for (const call of calls) {
          hookManager.leaveHook(call, this, args, returnValue);
        }
      } finally {
        leaveHookCode(leaveTid);
      }
      return returnValue;
    };
  }

  private runObservers(overload: HookedOverload, instance: Java.Wrapper, args: Java.Wrapper[], returnValue: any): void {
    for (const observer of overload.observers) {
      try {
        observer(instance, args, returnValue);
      } catch (e) {
        logger.error(`Error in an observer of ${overload.method.holder.$className}.${overload.method.methodName}: ${e}`);
      }
    }
  }

  // null if the stackTraceFilter or an argFilter doesn't match, or decoding fails
  private enterHook(installedHook: InstalledJavaHook, args: Java.Wrapper[], unsafeContext?: UnsafeContext): JavaHookCall | null {
    const { hook, target, inArgDecoders } = installedHook;
    let stackTrace: HookStackTrace;
    try {
      stackTrace = this.stackTrace.build(hook.hookSettings, undefined, unsafeContext);
    } catch (e) {
      if (!(e instanceof FilterMismatchError)) {
        logger.error(`Failed to build the stack trace of ${target}: ${e}`);
      }
      return null;
    }

    const logTarget = this.callLogTarget(target);
    const decodedArgs: DecodedArgs = { in: [], out: [] };
    if (inArgDecoders.length > 0) {
      try {
        decodedArgs.in = this.decodeArgs(args, inArgDecoders, logTarget);
      } catch (e) {
        if (!(e instanceof FilterMismatchError)) {
          logger.error(`Decoder error during 'onEnter' argument decoding of ${target}: ${e}`);
        }
        return null;
      }
    }
    return { installedHook, logTarget, stackTrace, decodedArgs };
  }

  private leaveHook(call: JavaHookCall, instance: Java.Wrapper, args: Java.Wrapper[], returnValue: any): void {
    const { hook, target, outArgDecoders, retTypeDecoder } = call.installedHook;
    const { decodedArgs, logTarget } = call;
    // first, as `out` parameters with `decoderArgs: { length: $ret }` need it
    let decodedRetValue: DecodedValue | undefined;
    if (retTypeDecoder) {
      try {
        decodedRetValue = this.decodeValue(retTypeDecoder, returnValue, `${logTarget} return value`);
      } catch (e) {
        logger.error(`Decoder error during return value decoding of ${target}: ${e}`);
        return;
      }
    }

    if (outArgDecoders.length > 0) {
      try {
        decodedArgs.out = this.decodeArgs(args, outArgDecoders, logTarget, decodedRetValue);
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
    this.frookyAgent.addEventToLog(new JavaHookEvent(hook, fieldType, hashCode, decodedArgs, decodedRetValue, call.stackTrace), hook);
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
