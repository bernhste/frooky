import Java from "frida-java-bridge";
import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { enterHookCode, leaveHookCode } from "../../shared/hook/hookCodeGuard";
import { DecodedArgs, HookManager, mapResolution, ParamDecoder, Resolution } from "../../shared/hook/hookManager";
import { JavaHookDeclaration } from "../../shared/hook/hookDeclaration";
import { logger } from "../../shared/logger";
import { HookStackTrace, needsStackTrace, PlatformStackTrace, UnsafeContext } from "../../shared/platformStackTrace";
import { fromSource, plural } from "../../shared/utils";
import { detectUnsafeContext } from "../../native/unsafeContext";
import { JavaDecoderResolver } from "../decoders/javaDecoderResolver";
import { javaIdentityHashCode } from "../decoders/utils/javaValues";
import { fixArtMethodAccessFlagsOffset, initializeClass, repairAccessFlags } from "../javaBridgeWorkarounds";
import { asFrooky } from "../scriptReplacements";
import { JavaHook } from "./javaHook";
import { countCalls, ReplacementCalls, RetiredReplacements } from "./retiredReplacements";
import { resolveMethodHooks } from "./javaMethodResolver";
import { JavaClassResolver, MethodObserver } from "./javaClassResolver";
import { JavaHookEvent } from "./javaHookEvent";

// frida-java-bridge looks up Class.isAssignableFrom() and Class.isInstance() of a ClassFactory when it first converts
// a value of an object type, e.g. the return value of an original method. The lookup calls
// Method.getGenericReturnType(), which ART builds with StringBuilder: with StringBuilder hooked, the conversion runs
// the hook again before the lookup finishes, until the stack overflows. Done before the factory's first hook instead.
function resolveClassMembers(factory: Java.ClassFactory): void {
  const stringClass = factory.use("java.lang.String").class;
  stringClass.isAssignableFrom(stringClass);
  stringClass.isInstance(null);
}

// How long prepareDetach() waits for the threads inside reverted replacements
const DETACH_RELEASE_TIMEOUT_MS = 3000;

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
// counts the calls in the dispatcher, see RetiredReplacements
// `target`: e.g. `java.lang.Integer.reverse` or `com.example.Foo.$init`
type HookedOverload = ReplacementCalls & { method: Java.Method; target: string; hooks: InstalledJavaHook[]; observers: MethodObserver[] };

// what a hook captured before the original method ran
// `logTarget`: see callLogTarget()
// `decodeMs`: time spent decoding the `in` args, see FrookyAgent.addEventToLog()
type JavaHookCall = { installedHook: InstalledJavaHook; logTarget: string; stackTrace: HookStackTrace; decodedArgs: DecodedArgs; decodeMs: number };

// Resolves and installs hooks on Java methods.
export class AndroidHookManager extends HookManager<JavaHookDeclaration, JavaHook, Java.Wrapper> {
  private readonly classResolver: JavaClassResolver;

  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    super(JavaDecoderResolver, platformStackTrace, frookyAgent);
    // before the first hook, also where the agent's entry point didn't run it, e.g. in tests
    fixArtMethodAccessFlagsOffset();
    this.classResolver = new JavaClassResolver(
      (method, methodName, observer) => this.observe(method, methodName, observer),
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
  private readonly retiredReplacements = new RetiredReplacements();
  // set by prepareDetach(), which leaves nothing hooked
  private detaching = false;

  // A hook on a class that isn't found yet is installed as soon as a class loader has it, before its code runs,
  // see JavaClassResolver. resolveHooks() resolves its promise afterwards, see registerHooks().
  async resolveHooks(inputHooks: JavaHookDeclaration[], source?: string): Promise<Resolution<JavaHook[] | null>[]> {
    logger.info(
      `Resolving ${plural(inputHooks.length, "Java hook")} in ${plural(new Set(inputHooks.map((h) => h.javaClass)).size, "class", "classes")}${fromSource(source)}`,
    );

    // each class is looked up once, no matter how many hooks target it
    const hookIndicesByClass = new Map<string, number[]>();
    inputHooks.forEach((inputHook, i) => {
      const key = `${inputHook.javaClass} ${inputHook.classLoader ?? ""}`;
      hookIndicesByClass.set(key, [...(hookIndicesByClass.get(key) ?? []), i]);
    });

    const results: Resolution<JavaHook[] | null>[] = new Array(inputHooks.length);
    for (const hookIndices of hookIndicesByClass.values()) {
      const { javaClass, classLoader } = inputHooks[hookIndices[0]];
      const classHooks = this.classResolver.find(javaClass, classLoader, (javaClasses, installNow) =>
        hookIndices.map((i) => {
          const hooks = resolveMethodHooks(javaClasses, inputHooks[i]);
          if (hooks && installNow) this.registerHooks(hooks, source);
          return hooks;
        }),
      );
      hookIndices.forEach((hookIndex, j) => (results[hookIndex] = mapResolution(classHooks, (hooks) => hooks[j])));
    }
    return results;
  }

  // Runs `observer` after every call of `method`, next to the hooks installed on it. `methodName`: the name `method` was
  // looked up by, e.g. `$init`
  observe(method: Java.Method, methodName: string, observer: MethodObserver): void {
    const overload = this.hookedOverload(method, `${method.holder.$className}.${methodName}`);
    overload.observers = [...overload.observers, observer];
  }

  // The HookedOverload of `method`, created and installed on first use. Throws if the method can't be hooked.
  private hookedOverload(method: Java.Method, target: string): HookedOverload {
    const key = method.handle.toString();
    let overload = this.hookedOverloads.get(key);
    if (!overload) {
      if (this.detaching) throw new Error("frooky is detaching");
      const factory: Java.ClassFactory = method.holder.$f;
      if (!this.preparedFactories.has(factory)) {
        resolveClassMembers(factory);
        this.preparedFactories.add(factory);
      }
      initializeClass(method);
      const newOverload: HookedOverload = { method, target, hooks: [], observers: [], inFlight: 0, finished: 0 };
      asFrooky(target, () => (newOverload.method.implementation = this.createDispatcher(newOverload)));
      repairAccessFlags(newOverload.method, target);
      overload = newOverload;
      this.hookedOverloads.set(key, overload);
    }
    return overload;
  }

  registerHooks(hooks: JavaHook[], source?: string): number {
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      if (this.installedHook(hook)) {
        countSuccessfulHooks++;
        continue;
      }
      const target = `${hook.method.holder.$className}.${hook.methodName}`;
      const installedHook = this.prepareHook(hook, target);

      let overload: HookedOverload;
      try {
        overload = this.hookedOverload(hook.method, target);
      } catch (e) {
        logger.warn(`Failed to hook ${target}: ${e}`);
        continue;
      }
      // copied on write: a call in progress keeps running the hooks it started with
      overload.hooks = [...overload.hooks, installedHook];
      logger.info(`Hooked ${target}(${hook.method.argumentTypes.map((t) => t.className ?? t.name).join(", ")})${fromSource(source)}`);
      const { callerFilter } = hook.hookSettings;
      if (callerFilter.length > 0) {
        logger.debug(`Caller filter on ${target}: records calls with a Java caller matching ${callerFilter.join(", ")}`);
      }

      countSuccessfulHooks++;
    }
    return countSuccessfulHooks;
  }

  describeInstalledHook(hook: JavaHook): string | undefined {
    return this.installedHook(hook)?.target;
  }

  otherHooksOnSameFunction(hook: JavaHook): JavaHook[] {
    const overload = this.hookedOverloads.get(hook.method.handle.toString());
    return overload ? overload.hooks.map((installedHook) => installedHook.hook).filter((other) => other !== hook) : [];
  }

  private installedHook(hook: JavaHook): InstalledJavaHook | undefined {
    return this.hookedOverloads.get(hook.method.handle.toString())?.hooks.find((installedHook) => installedHook.hook === hook);
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
        asFrooky(overload.target, () => this.retiredReplacements.revert(overload.method, overload));
      } catch (e) {
        logger.warn(`Failed to unhook ${overload.target}: ${e}`);
      }
    }
  }

  // Unhooks every overload, also the ones JavaClassResolver observes, and resolves once no thread can be inside their
  // replacements, or after DETACH_RELEASE_TIMEOUT_MS. Unloading the agent would free every replacement at once,
  // see RetiredReplacements. Hooks resolved afterwards aren't installed.
  async prepareDetach(): Promise<void> {
    this.detaching = true;
    for (const overload of this.hookedOverloads.values()) {
      try {
        asFrooky(overload.target, () => this.retiredReplacements.revert(overload.method, overload));
      } catch (e) {
        logger.warn(`Failed to unhook ${overload.target}: ${e}`);
      }
    }
    this.hookedOverloads.clear();
    if (!(await this.retiredReplacements.whenReleased(DETACH_RELEASE_TIMEOUT_MS))) {
      logger.warn(
        `${plural(this.retiredReplacements.size, "unhooked Java method")} still in use after ${DETACH_RELEASE_TIMEOUT_MS} ms, the app may crash when frooky detaches`,
      );
    }
  }

  // resolves the decoders once per hook, not per call
  private prepareHook(hook: JavaHook, target: string): InstalledJavaHook {
    const argDecoders = this.resolveArgDecoders(hook.params);
    let retTypeDecoder: Decoder<Java.Wrapper> | undefined;
    if (hook.method.returnType.className) {
      retTypeDecoder = this.resolveRetTypeDecoder({
        type: hook.method.returnType.className,
        declaringClass: hook.method.holder.$className,
        settings: hook.retTypeSettings ?? hook.decoderSettings,
      });
    }
    return {
      hook,
      target,
      inArgDecoders: argDecoders.in,
      outArgDecoders: argDecoders.out,
      retTypeDecoder,
      needsStackTrace: needsStackTrace(hook.hookSettings) || hook.hookSettings.callerFilter.length > 0,
    };
  }

  // Replaces the overload with dispatch(), counting the calls in it for RetiredReplacements
  private createDispatcher(overload: HookedOverload): Java.MethodImplementation {
    const hookManager = this;
    return countCalls(overload, function (this: Java.Wrapper, ...args: Java.Wrapper[]) {
      return hookManager.dispatch(overload, this, args);
    });
  }

  // Every hook decodes its `in` args, the original method runs once, then every hook that passed its filters decodes
  // its `out` args and return value and logs its event. A call made by hook code (see hookCodeGuard.ts) only runs the
  // original method and the observers.
  private dispatch(overload: HookedOverload, instance: Java.Wrapper, args: Java.Wrapper[]): any {
    const enterTid = enterHookCode();
    if (enterTid === undefined) {
      const returnValue = overload.method.apply(instance, args);
      this.runObservers(overload, instance, args, returnValue);
      return returnValue;
    }
    const calls: JavaHookCall[] = [];
    try {
      const hooks = overload.hooks;
      const unsafeContext = hooks.some((installedHook) => installedHook.needsStackTrace) ? detectUnsafeContext() : undefined;
      for (const installedHook of hooks) {
        const call = this.enterHook(installedHook, args, unsafeContext);
        if (call) calls.push(call);
      }
    } finally {
      leaveHookCode(enterTid);
    }

    let returnValue;
    try {
      returnValue = overload.method.apply(instance, args);
    } catch (e) {
      // observed methods such as ClassLoader.loadClass() throw as part of their normal work
      if (overload.hooks.length > 0) logger.error(`Error during execution of hooked method: ${e}`);
      throw e; // the app handles its own exception
    }

    const leaveTid = enterHookCode();
    if (leaveTid === undefined) return returnValue;
    try {
      this.runObservers(overload, instance, args, returnValue);
      for (const call of calls) {
        this.leaveHook(call, instance, args, returnValue);
      }
    } finally {
      leaveHookCode(leaveTid);
    }
    return returnValue;
  }

  private runObservers(overload: HookedOverload, instance: Java.Wrapper, args: Java.Wrapper[], returnValue: any): void {
    for (const observer of overload.observers) {
      try {
        observer(instance, args, returnValue);
      } catch (e) {
        logger.error(`Error in an observer of ${overload.target}: ${e}`);
      }
    }
  }

  // null if the callerFilter or an argFilter doesn't match, or decoding fails
  private enterHook(installedHook: InstalledJavaHook, args: Java.Wrapper[], unsafeContext?: UnsafeContext): JavaHookCall | null {
    const { hook, target, inArgDecoders } = installedHook;
    let stackTrace: HookStackTrace;
    try {
      stackTrace = this.stackTrace.build(hook.hookSettings, { unsafeContext, filterCallers: true });
    } catch (e) {
      this.reportHookError(hook, e, `Failed to build the stack trace of ${target}`);
      return null;
    }

    const logTarget = this.callLogTarget(target);
    const decodedArgs: DecodedArgs = { in: [], out: [] };
    const decodeStart = Date.now();
    if (inArgDecoders.length > 0) {
      try {
        decodedArgs.in = this.decodeArgs(args, inArgDecoders, logTarget);
      } catch (e) {
        this.reportHookError(hook, e, `Decoder error during 'onEnter' argument decoding of ${target}`);
        return null;
      }
    }
    return { installedHook, logTarget, stackTrace, decodedArgs, decodeMs: Date.now() - decodeStart };
  }

  private leaveHook(call: JavaHookCall, instance: Java.Wrapper, args: Java.Wrapper[], returnValue: any): void {
    const { hook, target, outArgDecoders, retTypeDecoder } = call.installedHook;
    const { decodedArgs, logTarget } = call;
    const decodeStart = Date.now();
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
        this.reportHookError(hook, e, `Decoder error during 'onLeave' argument decoding of ${target}`);
        return;
      }
    }
    const decodeMs = call.decodeMs + Date.now() - decodeStart;

    const fieldType = this.buildFieldType(instance);
    const hashCode = fieldType.fieldType === "instance" ? javaIdentityHashCode(instance) : undefined;
    this.frookyAgent.addEventToLog(new JavaHookEvent(hook, fieldType, hashCode, decodedArgs, decodedRetValue, call.stackTrace), hook, decodeMs);
  }

  private buildFieldType(instance: Java.Wrapper): FieldType {
    // `this` of a static method is the class wrapper, which has no object handle
    return { fieldType: instance?.$h == null ? "static" : "instance" };
  }
}
