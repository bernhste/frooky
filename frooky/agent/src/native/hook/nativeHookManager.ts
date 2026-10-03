import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { enterHookCode, leaveHookCode } from "../../shared/hook/hookCodeGuard";
import { countFilteredCall, filteredCallCount } from "../../shared/hook/hook";
import { DecodedArgs, HookManager, ParamDecoder } from "../../shared/hook/hookManager";
import { describeNativeTarget, InputNativeHookNormalized } from "../../shared/inputParsing/inputNativeHookCollection";
import { logger } from "../../shared/logger";
import { EMPTY_STACK_TRACE, HookStackTrace, needsStackTrace, PlatformStackTrace, UnsafeContext } from "../../shared/platformStackTrace";
import { FilterMismatchError, fromSource, plural } from "../../shared/utils";
import { NativeDecoderResolver } from "../decoders/nativeDecoderResolver";
import { detectUnsafeContext } from "../unsafeContext";
import { NativeCallerFilter } from "../nativeCallerFilter";
import { NativeErrnoDecoder } from "../decoders/nativeErrnoDecoder";
import { planArgSlots, planFloatRetTypeSlot, readFloatArgBits, usesSeparateFloatRegisterFile } from "./nativeFloatArgs";
import { NativeHook } from "./nativeHook";
import { addressHashCode, NativeHookEvent } from "./nativeHookEvent";
import { MAX_FILTERED_ARGS, ModuleRange, NativeFilteredListener } from "./nativeFilteredListener";

// the most bytes the Interceptor overwrites at a hooked address (an absolute jump on x86_64 or arm64)
const INTERCEPTOR_PATCH_BYTES = 16;

// A registered hook with what it uses on every call, resolved once
type InstalledNativeHook = {
  hook: NativeHook;
  target: string; // e.g. `libfoo.so!open` or `libfoo.so+0x1a2b4`
  inArgDecoders: ParamDecoder<NativePointer>[];
  outArgDecoders: ParamDecoder<NativePointer>[];
  retTypeDecoder?: Decoder<NativePointer>;
  argSlots: ReturnType<typeof planArgSlots>;
  hasFloatArgs: boolean;
  floatRetSlot: ReturnType<typeof planFloatRetTypeSlot>;
  needsStackTrace: boolean;
  callerFilter?: NativeCallerFilter;
  // the same for every call
  hashCode: string;
};

// `native` is set while the function's callerFilters run in native code, see updateListener()
type HookedFunction = { address: NativePointer; listener?: InvocationListener; native?: NativeFilteredListener; hooks: InstalledNativeHook[] };

// Why `hooks` need the JS listener instead of a NativeFilteredListener, which passes calls on without the CPU
// context, or undefined if they don't
function jsListenerReason(hooks: InstalledNativeHook[]): string | undefined {
  for (const { hook, callerFilter, hasFloatArgs, floatRetSlot } of hooks) {
    if (!callerFilter) return "a hook has no callerFilter";
    if (hook.hookSettings.nativeStackTrace) return "a hook records native stack traces";
    if (hasFloatArgs || floatRetSlot) return "a hook decodes float or double values";
    if ((hook.params?.length ?? 0) > MAX_FILTERED_ARGS) return `a hook has more than ${MAX_FILTERED_ARGS} params`;
  }
  return undefined;
}

// the modules of all callerFilters of `hooks`
function callerRanges(hooks: InstalledNativeHook[]): ModuleRange[] {
  return hooks.flatMap((installedHook) => installedHook.callerFilter?.moduleRanges ?? []);
}

// Moves the calls a NativeFilteredListener dropped for `hook` into its own count, before that listener goes
function keepNativeFilteredCalls(hook: NativeHook): void {
  hook.filteredCalls = filteredCallCount(hook);
  hook.nativeFilteredCalls = undefined;
}

// Whether a call from `returnAddress` passes the callerFilter of any of `hooks` (a hook without one passes).
// Runs on every call of a hooked function, so a plain loop without a closure.
function passesAnyCallerFilter(hooks: InstalledNativeHook[], returnAddress: NativePointer): boolean {
  for (let i = 0; i < hooks.length; i++) {
    const callerFilter = hooks[i].callerFilter;
    if (!callerFilter || callerFilter.matches(returnAddress)) return true;
  }
  return false;
}

// what a hook captured in onEnter
type NativeHookCall = {
  installedHook: InstalledNativeHook;
  logTarget: string; // see callLogTarget()
  argsIn: DecodedValue[];
  // the arguments for `out` params, as InvocationArguments is only valid during onEnter
  savedArgs?: NativePointer[];
  stackTrace: HookStackTrace;
  // time spent decoding the `in` args, see FrookyAgent.addEventToLog()
  decodeMs: number;
};

export class NativeHookManager extends HookManager<InputNativeHookNormalized, NativeHook, NativePointer> {
  private installedHooks = new Set<NativeHook>();
  // the hooks installed on a function, keyed by its address. Several configs can hook the same function and each
  // records its own event per call.
  private readonly hookedFunctions = new Map<string, HookedFunction>();
  // called with a module once it loads, keyed by the name (or path) hooks declare it with
  private readonly moduleWaiters = new Map<string, ((module: Module) => void)[]>();
  private moduleObserver?: ModuleObserver;

  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    super(NativeDecoderResolver, platformStackTrace, frookyAgent);
  }

  // Native hooks default to waiting for FrookyAgent.targetReady before installation to ensure
  // stability during early process bootstrap. Hooks with `early: true` are installed immediately or inside
  // the linker before constructors and JNI_OnLoad run.
  public async resolveHooks(inputHooks: InputNativeHookNormalized[], source?: string): Promise<Promise<NativeHook[] | null>[]> {
    logger.info(
      `Resolving ${plural(inputHooks.length, "native hook")} in ${plural(new Set(inputHooks.map((h) => h.module)).size, "module")}${fromSource(source)}`,
    );
    const earlyCount = inputHooks.filter((inputHook) => inputHook.hookSettings?.early).length;
    if (earlyCount > 0 && !this.frookyAgent.isTargetReady) {
      logger.info(`Early hooking: installing ${plural(earlyCount, "native hook")} with 'early: true' before targetReady${fromSource(source)}`);
    }

    // each module is looked up once, no matter how many hooks target it
    const hookIndicesByModule = new Map<string, number[]>();
    inputHooks.forEach((inputHook, i) => hookIndicesByModule.set(inputHook.module, [...(hookIndicesByModule.get(inputHook.module) ?? []), i]));

    const results: Promise<NativeHook[] | null>[] = new Array(inputHooks.length);
    for (const [moduleName, hookIndices] of hookIndicesByModule) {
      const moduleHooks = this.whenModuleLoaded(moduleName, (module, isLoading) => {
        // getExportByName() makes the linker abort the process while it loads `module`, reading the ELF doesn't
        let exports: Map<string, NativePointer> | undefined;
        const findExport = isLoading
          ? (symbol: string) => (exports ??= new Map(module.enumerateExports().map((e) => [e.name, e.address]))).get(symbol)
          : (symbol: string) => module.findExportByName(symbol) ?? undefined;
        return hookIndices.map(async (i) => {
          const inputHook = inputHooks[i];
          const hooks = this.resolveHook(inputHook, module, findExport);
          if (!hooks) return null;
          if (!inputHook.hookSettings?.early) {
            await (this.frookyAgent.targetReady ?? Promise.resolve());
          }
          if (isLoading) this.registerHooks(hooks, source);
          return hooks;
        });
      });
      hookIndices.forEach((hookIndex, j) => (results[hookIndex] = moduleHooks.then((hooks) => hooks[j])));
    }
    return results;
  }

  // null if the symbol or offset doesn't resolve
  private resolveHook(
    inputHook: InputNativeHookNormalized,
    module: Module,
    findExport: (symbol: string) => NativePointer | undefined,
  ): NativeHook[] | null {
    const target = describeNativeTarget(inputHook.module, inputHook);
    try {
      const symbolAddress =
        inputHook.symbol !== undefined
          ? this.resolveSymbol(inputHook.symbol, module, findExport)
          : this.resolveModuleOffset(String(inputHook.offset), module);
      logger.debug(`Address of function ${target} found: ${symbolAddress}.`);
      return [
        {
          module,
          moduleName: module.name,
          symbolName: inputHook.symbol,
          offset: inputHook.offset === undefined ? undefined : String(inputHook.offset),
          symbolAddress,
          params: inputHook.params,
          retType: inputHook.retType,
          hookSettings: inputHook.hookSettings,
          decoderSettings: inputHook.decoderSettings,
        },
      ] as NativeHook[];
    } catch (e) {
      logger.warn(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  // Calls `onLoaded` with the module once it is loaded, or right away if it already is, and resolves with its result.
  // `isLoading` is set while the linker loads the module.
  private whenModuleLoaded<T>(moduleName: string, onLoaded: (module: Module, isLoading: boolean) => T): Promise<T> {
    const loadedModule = Process.findModuleByName(moduleName);
    if (loadedModule) {
      logger.debug(`Module '${moduleName}' already loaded.`);
      return Promise.resolve(onLoaded(loadedModule, false));
    }
    logger.debug(`Waiting for native module ${moduleName} to load.`);
    return new Promise((resolve, reject) => {
      const waiter = (module: Module) => {
        logger.debug(`Module '${moduleName}' loaded.`);
        try {
          resolve(onLoaded(module, true));
        } catch (e) {
          reject(e);
        }
      };
      this.moduleWaiters.set(moduleName, [...(this.moduleWaiters.get(moduleName) ?? []), waiter]);
      this.observeModules();
    });
  }

  // Attached once and kept: attaching calls onAdded() for every loaded module.
  private observeModules(): void {
    this.moduleObserver ??= Process.attachModuleObserver({
      // runs on the thread that loads the module, inside the linker
      onAdded: (module) => {
        const waiters = this.moduleWaiters.get(module.name) ?? this.moduleWaiters.get(module.path);
        if (!waiters) return;
        this.moduleWaiters.delete(module.name);
        this.moduleWaiters.delete(module.path);
        for (const waiter of waiters) waiter(module);
      },
    });
  }

  // Hooks that are already installed, e.g. by resolveHooks() while their module loaded, count as installed.
  public registerHooks(hooks: NativeHook[], source?: string): number {
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      if (this.installedHooks.has(hook)) {
        countSuccessfulHooks++;
        continue;
      }
      const target = describeNativeTarget(hook.moduleName, { symbol: hook.symbolName, offset: hook.offset });
      const installedHook = this.prepareHook(hook, target);

      const key = hook.symbolAddress.toString();
      const hookedFunction: HookedFunction = this.hookedFunctions.get(key) ?? { address: hook.symbolAddress, hooks: [] };
      const previousHooks = hookedFunction.hooks;
      // copied on write: a call in progress keeps running the hooks it entered
      hookedFunction.hooks = [...previousHooks, installedHook];
      try {
        this.updateListener(hookedFunction, target);
      } catch (e) {
        logger.warn(`Failed to hook ${target}: ${e}`);
        installedHook.callerFilter?.dispose();
        hookedFunction.hooks = previousHooks;
        if (previousHooks.length > 0) this.tryUpdateListener(hookedFunction, target);
        continue;
      }
      this.hookedFunctions.set(key, hookedFunction);
      if (installedHook.callerFilter) {
        installedHook.callerFilter.onChange = () => hookedFunction.native?.setRanges(callerRanges(hookedFunction.hooks));
      }
      // e.g. memmove and memcpy, which are one function in some libcs
      const alias = previousHooks.find((other) => other.target !== target);
      if (alias) {
        logger.warn(`${target} is the same function as ${alias.target} (${hook.symbolAddress}): each call is recorded once per hook.`);
      }
      this.installedHooks.add(hook);
      logger.info(`Hooked ${target} at ${hook.symbolAddress}${fromSource(source)}`);
      if (installedHook.callerFilter) logger.debug(installedHook.callerFilter.describe());
      countSuccessfulHooks++;
    }
    return countSuccessfulHooks;
  }

  public unregisterHooks(hooks: NativeHook[]): void {
    for (const hook of hooks) {
      const key = hook.symbolAddress.toString();
      const hookedFunction = this.hookedFunctions.get(key);
      const index = hookedFunction ? hookedFunction.hooks.findIndex((installedHook) => installedHook.hook === hook) : -1;
      if (!hookedFunction || index < 0) continue;

      hookedFunction.hooks[index].callerFilter?.dispose();
      keepNativeFilteredCalls(hook);
      hookedFunction.hooks = hookedFunction.hooks.filter((_, i) => i !== index);
      hook.listener = undefined;
      if (!hookedFunction.hooks.some((installedHook) => installedHook.hook === hook)) this.installedHooks.delete(hook);
      if (hookedFunction.hooks.length > 0) {
        // the remaining hooks may now fit a NativeFilteredListener
        this.tryUpdateListener(hookedFunction, hookedFunction.hooks[0].target);
        continue;
      }

      this.hookedFunctions.delete(key);
      this.detachListener(hookedFunction);
    }
  }

  // Attaches the listener the hooks of `hookedFunction` need, replacing the attached one if it's the other kind:
  // a NativeFilteredListener if all of them have a callerFilter and none needs the CPU context, else the JS
  // dispatcher. Throws if the Interceptor can't hook the function.
  private updateListener(hookedFunction: HookedFunction, target: string): void {
    const { hooks } = hookedFunction;
    let reason = jsListenerReason(hooks);
    if (reason === undefined) {
      const argCount = Math.max(0, ...hooks.map((installedHook) => installedHook.hook.params?.length ?? 0));
      if (!hookedFunction.native) {
        this.detachListener(hookedFunction);
        try {
          hookedFunction.native = new NativeFilteredListener(
            hookedFunction.address,
            callerRanges(hooks),
            argCount,
            (args, returnAddress, sp) => this.enterHooks(hookedFunction.hooks, args, { sp } as CpuContext, returnAddress),
            (calls, returnValue, errno) => this.leaveHooks(calls as NativeHookCall[], returnValue as InvocationReturnValue, undefined, errno),
          );
          hookedFunction.listener = hookedFunction.native.listener;
          logger.debug(`Caller filter on ${target}: checked in native code`);
        } catch (e) {
          reason = `the native caller filter failed: ${e}`;
        }
      } else {
        hookedFunction.native.setRanges(callerRanges(hooks));
        hookedFunction.native.setArgCount(argCount);
      }
    }
    if (reason !== undefined && (hookedFunction.native || !hookedFunction.listener)) {
      this.detachListener(hookedFunction);
      hookedFunction.listener = Interceptor.attach(hookedFunction.address, this.createDispatcher(hookedFunction));
      if (hooks.some((installedHook) => installedHook.callerFilter)) logger.debug(`Caller filter on ${target}: checked in JS, as ${reason}`);
    }
    const native = hookedFunction.native;
    for (const { hook } of hooks) {
      hook.listener = hookedFunction.listener;
      if (native && !hook.nativeFilteredCalls) {
        const before = native.filteredCalls;
        hook.nativeFilteredCalls = () => native.filteredCalls - before;
      }
    }
  }

  // updateListener() for hooks that were hooked before, which stay hooked by the attached listener if it fails
  private tryUpdateListener(hookedFunction: HookedFunction, target: string): void {
    try {
      this.updateListener(hookedFunction, target);
    } catch (e) {
      logger.warn(`Failed to update the hook of ${target}: ${e}`);
    }
  }

  private detachListener(hookedFunction: HookedFunction): void {
    if (hookedFunction.native) {
      for (const { hook } of hookedFunction.hooks) keepNativeFilteredCalls(hook);
      hookedFunction.native.detach();
    } else {
      hookedFunction.listener?.detach();
    }
    hookedFunction.native = undefined;
    hookedFunction.listener = undefined;
  }

  // resolves the decoders and argument slots once per hook, not per call
  private prepareHook(hook: NativeHook, target: string): InstalledNativeHook {
    let inArgDecoders: ParamDecoder<NativePointer>[] = [];
    let outArgDecoders: ParamDecoder<NativePointer>[] = [];
    if (hook.params) {
      const argDecoders = this.resolveParamDecoders(hook.params);
      inArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "in" || argDecoder.direction === "inout");
      outArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "out" || argDecoder.direction === "inout");
    }
    // float/double params and return values are in FP registers, not in args[]/returnValue
    const argSlots = planArgSlots(hook.params);
    return {
      hook,
      target,
      inArgDecoders,
      outArgDecoders,
      retTypeDecoder: hook.retType ? this.resolveRetTypeDecoder(hook.retType) : undefined,
      argSlots,
      hasFloatArgs: argSlots.some((slot) => slot.kind === "float"),
      floatRetSlot: planFloatRetTypeSlot(hook.retType),
      needsStackTrace: needsStackTrace(hook.hookSettings),
      callerFilter: hook.hookSettings.callerFilter.length > 0 ? new NativeCallerFilter(hook.hookSettings.callerFilter, target) : undefined,
      hashCode: addressHashCode(hook.symbolAddress),
    };
  }

  // One Interceptor listener per function runs all of its hooks: the Interceptor keeps per-call data for only
  // two listeners with both onEnter and onLeave, and skips every onLeave of a function with more of them.
  private createDispatcher(hookedFunction: HookedFunction): InvocationListenerCallbacks {
    const hookManager = this;
    // per-call state lives on `this` (Frida's invocation context): another thread or a recursive call can
    // enter the function between onEnter and onLeave
    return {
      onEnter: function (args: NativePointer[]) {
        this.calls = undefined;
        // before anything else: on a hot function, the callerFilter drops most calls
        const returnAddress = this.returnAddress;
        const hooks = hookedFunction.hooks;
        if (!passesAnyCallerFilter(hooks, returnAddress)) {
          for (let i = 0; i < hooks.length; i++) countFilteredCall(hooks[i].hook);
          return;
        }
        this.calls = hookManager.enterHooks(hooks, args, this.context, returnAddress);
      },
      onLeave: function (returnValue: InvocationReturnValue) {
        const calls: NativeHookCall[] | undefined = this.calls;
        if (!calls) return;
        // before running any code that could set it
        const errno = this.errno;
        hookManager.leaveHooks(calls, returnValue, this.context, errno);
      },
    };
  }

  // The calls of `hooks` that passed their filters, for leaveHooks(), or undefined if none did. `context` only
  // has `sp` when called from a NativeFilteredListener.
  private enterHooks(
    hooks: InstalledNativeHook[],
    args: InvocationArguments | NativePointer[],
    context: CpuContext,
    returnAddress: NativePointer,
  ): NativeHookCall[] | undefined {
    const tid = enterHookCode();
    if (tid === undefined) return undefined;
    try {
      const calls: NativeHookCall[] = [];
      // detected at most once per call, and only for hooks whose caller filter passed
      let unsafeContext: UnsafeContext | undefined | null = null;
      const detectUnsafe = () => (unsafeContext === null ? (unsafeContext = detectUnsafeContext(context)) : unsafeContext);
      for (const installedHook of hooks) {
        const call = this.enterHook(installedHook, args, context, returnAddress, detectUnsafe);
        if (call) calls.push(call);
      }
      return calls.length > 0 ? calls : undefined;
    } finally {
      leaveHookCode(tid);
    }
  }

  // `context` is undefined when called from a NativeFilteredListener
  private leaveHooks(calls: NativeHookCall[], returnValue: InvocationReturnValue, context: CpuContext | undefined, errno: number): void {
    const tid = enterHookCode();
    if (tid === undefined) return;
    try {
      for (const call of calls) {
        this.leaveHook(call, returnValue, context, errno);
      }
    } finally {
      leaveHookCode(tid);
    }
  }

  // null if the callerFilter or an argFilter doesn't match, or decoding fails
  private enterHook(
    installedHook: InstalledNativeHook,
    args: InvocationArguments | NativePointer[],
    context: CpuContext,
    returnAddress: NativePointer,
    detectUnsafe: () => UnsafeContext | undefined,
  ): NativeHookCall | null {
    const { hook, target, inArgDecoders, outArgDecoders, argSlots, hasFloatArgs, callerFilter } = installedHook;
    // first, as it is the cheapest check and drops most calls of a hot function
    if (callerFilter && !callerFilter.matches(returnAddress)) {
      countFilteredCall(hook);
      return null;
    }
    try {
      const call: NativeHookCall = { installedHook, logTarget: this.callLogTarget(target), argsIn: [], stackTrace: EMPTY_STACK_TRACE, decodeMs: 0 };
      if (hook.params) {
        let effectiveArgs: NativePointer[];
        const separateFloatLanes = usesSeparateFloatRegisterFile();
        if (hasFloatArgs) {
          // args[] only holds general-purpose registers, float/double params are read from FP registers
          effectiveArgs = new Array(hook.params.length);
          for (let i = 0; i < hook.params.length; i++) {
            const slot = argSlots[i];
            if (slot.kind === "float" && separateFloatLanes) {
              effectiveArgs[i] = readFloatArgBits(context, slot) ?? ptr(0);
            } else if (slot.kind === "float") {
              effectiveArgs[i] = args[i];
            } else {
              effectiveArgs[i] = separateFloatLanes ? args[slot.argIndex] : args[i];
            }
          }
        } else {
          effectiveArgs = args as unknown as NativePointer[];
        }

        if (inArgDecoders.length > 0) {
          const decodeStart = Date.now();
          call.argsIn = this.decodeArgs(effectiveArgs, inArgDecoders, call.logTarget);
          call.decodeMs = Date.now() - decodeStart;
        }

        if (outArgDecoders.length > 0) {
          // Frida's InvocationArgs proxy is only valid during onEnter.
          // For `out` params decoded onLeave, snapshot the arguments into a JS array.
          if (hasFloatArgs) {
            call.savedArgs = effectiveArgs;
          } else {
            const numArgs = hook.params.length;
            const saved: NativePointer[] = new Array(numArgs);
            for (let i = 0; i < numArgs; i++) {
              saved[i] = args[i];
            }
            call.savedArgs = saved;
          }
        }
      }

      if (installedHook.needsStackTrace) {
        call.stackTrace = this.stackTrace.build(hook.hookSettings, {
          ctx: context,
          unsafeContext: detectUnsafe(),
          filterCallers: false,
        });
      }
      return call;
    } catch (e) {
      if (e instanceof FilterMismatchError) countFilteredCall(hook);
      else logger.error(`Error during 'onEnter' of ${target}: ${e}`);
      return null;
    }
  }

  // `errno` is the errno right after the call, for `decoder: errno`
  // `context` is only needed for float/double return values, which NativeFilteredListener never passes on
  private leaveHook(call: NativeHookCall, returnValue: InvocationReturnValue, context: CpuContext | undefined, errno: number): void {
    const { hook, target, outArgDecoders, retTypeDecoder, floatRetSlot } = call.installedHook;
    try {
      const decodeStart = Date.now();
      // first, as `out` parameters with `decoderArgs: { length: $ret }` need it
      let decodedRetValue: DecodedValue | undefined;
      if (retTypeDecoder) {
        // returnValue is the general-purpose return register, a float/double is returned in an FP register
        const floatRetBits = floatRetSlot && context && usesSeparateFloatRegisterFile() ? readFloatArgBits(context, floatRetSlot) : null;
        decodedRetValue =
          retTypeDecoder instanceof NativeErrnoDecoder
            ? retTypeDecoder.decodeWithErrno(returnValue, errno)
            : this.decodeValue(retTypeDecoder, floatRetBits ?? returnValue, `${call.logTarget} return value`);
      }

      const decodedArgs: DecodedArgs = { in: call.argsIn, out: [] };
      if (outArgDecoders.length > 0) {
        decodedArgs.out = this.decodeArgs(call.savedArgs!, outArgDecoders, call.logTarget, decodedRetValue);
      }
      const decodeMs = call.decodeMs + Date.now() - decodeStart;

      this.frookyAgent.addEventToLog(
        new NativeHookEvent(hook, call.installedHook.hashCode, decodedArgs, decodedRetValue, call.stackTrace),
        hook,
        decodeMs,
      );
    } catch (e) {
      if (e instanceof FilterMismatchError) countFilteredCall(hook);
      else logger.error(`Error during 'onLeave' of ${target}: ${e}`);
    }
  }

  // Whether `address` is in a module with an installed hook. Called for every native exception, see
  // installCrashReporter(), so it only compares addresses.
  public isInHookedModule(address: NativePointer): boolean {
    for (const hook of this.installedHooks) {
      if (address.compare(hook.module.base) >= 0 && address.compare(hook.module.base.add(hook.module.size)) < 0) return true;
    }
    return false;
  }

  // The installed hooks (e.g. `libfoo.so+0x1a2b4`) in the modules that contain any of `addresses`.
  public describeHooksInModulesOf(addresses: NativePointer[]): string[] {
    const hooks = [...this.installedHooks].filter((hook) =>
      addresses.some((address) => address.compare(hook.module.base) >= 0 && address.compare(hook.module.base.add(hook.module.size)) < 0),
    );
    return hooks.map((hook) => describeNativeTarget(hook.moduleName, { symbol: hook.symbolName, offset: hook.offset }));
  }

  // The installed hook whose function contains `address`: `address` is in the bytes the Interceptor patched, or
  // has the same symbol as the hook (e.g. `receive_utf8+0x3` and `receive_utf8`).
  public describeHookedFunctionAt(address: NativePointer): string | undefined {
    const functionName = (symbol: DebugSymbol) =>
      symbol.name === null || symbol.name.startsWith("0x") ? null : symbol.name.replace(/\+0x[0-9a-f]+$/, "");
    const symbol = DebugSymbol.fromAddress(address);
    const name = functionName(symbol);
    const hook = [...this.installedHooks].find(
      (hook) =>
        (address.compare(hook.symbolAddress) >= 0 && address.compare(hook.symbolAddress.add(INTERCEPTOR_PATCH_BYTES)) < 0) ||
        (name !== null && symbol.moduleName === hook.moduleName && functionName(DebugSymbol.fromAddress(hook.symbolAddress)) === name),
    );
    return hook ? describeNativeTarget(hook.moduleName, { symbol: hook.symbolName, offset: hook.offset }) : undefined;
  }

  private resolveSymbol(symbol: string, module: Module, findExport: (symbol: string) => NativePointer | undefined): NativePointer {
    const address = findExport(symbol);
    if (!address) throw Error(`Skipping hook for '${symbol}'. This symbol does not exist in module '${module.name}'.`);
    return address;
  }

  // `module.base + offset`. Throws unless the address is inside the module and in a code section: patching
  // data, e.g. with an offset from another build of the library, crashes the app.
  private resolveModuleOffset(offset: string, module: Module): NativePointer {
    const target = `${module.name}+${offset}`;
    const moduleOffset = ptr(offset);
    if (moduleOffset.compare(ptr(module.size)) >= 0) {
      throw Error(`Skipping hook for '${target}'. The offset is outside the module, which is only 0x${module.size.toString(16)} bytes large.`);
    }
    const address = module.base.add(offset);
    const range = Process.findRangeByAddress(address);
    if (!range || !range.protection.includes("x")) {
      throw Error(
        `Skipping hook for '${target}'. The address ${address} is not executable (${range ? range.protection : "unmapped"}); check that the offset is a function's virtual address minus the image base, not a file offset.`,
      );
    }
    // small libraries often map .rodata, .dynsym etc. into the executable segment of .text
    const section = module.enumerateSections().find((s) => address.compare(s.address) >= 0 && address.compare(s.address.add(s.size)) < 0);
    if (section && !/^\.(text|plt|init|fini)/.test(section.name)) {
      throw Error(
        `Skipping hook for '${target}'. The offset points into the section '${section.name}', which holds data, not code; check that the offset is the function's address in this exact build and ABI of the library (e.g. from 'nm -D --defined-only ${module.name}').`,
      );
    }
    return address;
  }
}
