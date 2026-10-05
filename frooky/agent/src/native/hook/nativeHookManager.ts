import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { enterHookCode, leaveHookCode } from "../../shared/hook/hookCodeGuard";
import { countFilteredCall, filteredCallCount } from "../../shared/hook/hook";
import { DecodedArgs, HookManager, LaterHooks, ParamDecoder, Resolution, Waiting } from "../../shared/hook/hookManager";
import { NativeHookDeclaration, NativeSymbolHookDeclaration } from "../../shared/hook/hookDeclaration";
import { describeNativeTarget } from "../../shared/inputParsing/inputNativeHookCollection";
import { logger } from "../../shared/logger";
import { EMPTY_STACK_TRACE, HookStackTrace, needsStackTrace, PlatformStackTrace, UnsafeContext } from "../../shared/platformStackTrace";
import { fromSource, namePatternToRegExp, plural } from "../../shared/utils";
import { NativeDecoderResolver } from "../decoders/nativeDecoderResolver";
import { detectUnsafeContext } from "../unsafeContext";
import { NativeCallerFilter } from "../nativeCallerFilter";
import { NativeModuleWatcher } from "../nativeModuleWatcher";
import { NativeErrnoDecoder } from "../decoders/nativeErrnoDecoder";
import { collectArgs, planArgSlots, planFloatRetTypeSlot, readFloatArgBits, usesSeparateFloatRegisterFile } from "./nativeFloatArgs";
import { ModuleExports, moduleExports, resolveNativeHook, resolveNativeHookInMatchingModule } from "./nativeAddressResolver";
import { NativeHook } from "./nativeHook";
import { NativeHookIndex } from "./nativeHookIndex";
import { addressHashCode, NativeHookEvent } from "./nativeHookEvent";
import { MAX_FILTERED_ARGS, ModuleRange, NativeFilteredListener } from "./nativeFilteredListener";

// A hook declaration with a module wildcard pattern while resolveModulePatterns() looks for its hooks
type ModulePatternHook = {
  index: number;
  inputHook: NativeSymbolHookDeclaration;
  pattern: RegExp;
  // a matching module had hooks, so its Resolution isn't Waiting
  found: boolean;
  // its Resolution has its first hooks, later ones go to LaterHooks
  settled: boolean;
  settle: (hooks: NativeHook[]) => void;
  firstHooks: Promise<NativeHook[]>;
  // removed, or found without LaterHooks to take more
  stopped: boolean;
};

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

export class NativeHookManager extends HookManager<NativeHookDeclaration, NativeHook, NativePointer> {
  // the installed hooks, for the crash reporter, see installCrashReporter()
  public readonly hookIndex = new NativeHookIndex();
  // the hooks installed on a function, keyed by its address. Several configs can hook the same function and each
  // records its own event per call.
  private readonly hookedFunctions = new Map<string, HookedFunction>();
  private readonly moduleWatcher = new NativeModuleWatcher();

  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    super(NativeDecoderResolver, platformStackTrace, frookyAgent);
  }

  // Native hooks wait for FrookyAgent.targetReady before they are installed, to keep the app stable while it starts.
  // Hooks with `early: true` are installed right away, or inside the linker before the module's constructors and
  // JNI_OnLoad run. The Resolution of a hook on a loaded module is its hooks, or a promise of them if it waits for
  // targetReady. The Resolution of a hook on a module that isn't loaded is decided at targetReady: its hooks if the
  // module loaded by then, else Waiting. For a module wildcard pattern, see resolveModulePatterns().
  public async resolveHooks(
    inputHooks: NativeHookDeclaration[],
    source?: string,
    laterHooks?: LaterHooks<NativeHook[]>,
  ): Promise<Resolution<NativeHook[] | null>[]> {
    logger.info(
      `Resolving ${plural(inputHooks.length, "native hook")} in ${plural(new Set(inputHooks.map((h) => h.module)).size, "module")}${fromSource(source)}`,
    );
    const earlyCount = inputHooks.filter((inputHook) => inputHook.hookSettings.early).length;
    if (earlyCount > 0 && !this.frookyAgent.isTargetReady) {
      logger.info(`Early hooking: installing ${plural(earlyCount, "native hook")} with 'early: true' before targetReady${fromSource(source)}`);
    }

    // each module is looked up once, no matter how many hooks target it
    const hookIndicesByModule = new Map<string, number[]>();
    const patternIndices: number[] = [];
    inputHooks.forEach((inputHook, i) => {
      if (inputHook.module.includes("*")) patternIndices.push(i);
      else hookIndicesByModule.set(inputHook.module, [...(hookIndicesByModule.get(inputHook.module) ?? []), i]);
    });

    const results: Resolution<NativeHook[] | null>[] = new Array(inputHooks.length);
    if (patternIndices.length > 0) this.resolveModulePatterns(inputHooks, patternIndices, results, source, laterHooks);
    for (const [moduleName, hookIndices] of hookIndicesByModule) {
      const loadedModule = Process.findModuleByName(moduleName);
      if (loadedModule) {
        logger.debug(`Module '${moduleName}' already loaded.`);
        const exports = moduleExports(loadedModule, true);
        for (const i of hookIndices) results[i] = this.resolveInLoadedModule(inputHooks[i], loadedModule, exports);
        continue;
      }
      let loaded = false;
      const moduleHooks = this.moduleWatcher.whenLoaded(moduleName, (module) => {
        loaded = true;
        const exports = moduleExports(module, false);
        return hookIndices.map((i) => this.installWhileLoading(inputHooks[i], module, exports, source));
      });
      hookIndices.forEach((hookIndex, j) => {
        const hooks = moduleHooks.then((moduleResults) => moduleResults[j]);
        results[hookIndex] = this.targetReady().then<NativeHook[] | null | Waiting<NativeHook[] | null>>(() => (loaded ? hooks : { waiting: hooks }));
      });
    }
    return results;
  }

  // Sets the Resolutions of the hooks at `indices`, declared with a module wildcard pattern, e.g. `libssl*.so`: their
  // hooks in every module whose name matches, loaded already or later. The Resolution is the hooks in the loaded
  // modules, or, without any, decided at targetReady as for a module that isn't loaded: Waiting for the first module
  // that loads with hooks. The hooks in modules that load after that go to `laterHooks`. The modules are listed once and
  // the exports of each are read at most once for all these declarations.
  private resolveModulePatterns(
    inputHooks: NativeHookDeclaration[],
    indices: number[],
    results: Resolution<NativeHook[] | null>[],
    source?: string,
    laterHooks?: LaterHooks<NativeHook[]>,
  ): void {
    const patternHooks: ModulePatternHook[] = [];
    for (const index of indices) {
      const inputHook = inputHooks[index];
      // NativeHookValidator rejects an offset with a module pattern
      if (inputHook.symbol === undefined) {
        results[index] = null;
        continue;
      }
      let settle: (hooks: NativeHook[]) => void = () => {};
      const firstHooks = new Promise<NativeHook[]>((resolve) => (settle = resolve));
      patternHooks.push({
        index,
        inputHook,
        pattern: namePatternToRegExp(inputHook.module),
        found: false,
        settled: false,
        settle,
        firstHooks,
        stopped: false,
      });
    }
    // module paths, so a module the watcher reports again isn't hooked twice
    const resolvedModules = new Set<string>();
    const matching = (module: Module) => patternHooks.filter((patternHook) => !patternHook.stopped && patternHook.pattern.test(module.name));

    const loadedHooks = new Map<ModulePatternHook, NativeHook[]>();
    for (const module of Process.enumerateModules()) {
      const matches = matching(module);
      if (matches.length === 0) continue;
      resolvedModules.add(module.path);
      const exports = moduleExports(module, true);
      for (const patternHook of matches) {
        const hooks = resolveNativeHookInMatchingModule(patternHook.inputHook, module, exports);
        if (hooks.length > 0) loadedHooks.set(patternHook, [...(loadedHooks.get(patternHook) ?? []), ...hooks]);
      }
    }
    for (const patternHook of patternHooks) {
      const hooks = loadedHooks.get(patternHook);
      if (hooks) {
        logger.debug(`${plural(hooks.length, "function")} in loaded modules matching '${patternHook.inputHook.module}' resolved.`);
        patternHook.found = patternHook.settled = true;
        patternHook.stopped = !laterHooks;
        results[patternHook.index] =
          patternHook.inputHook.hookSettings.early || this.frookyAgent.isTargetReady ? hooks : this.targetReady().then(() => hooks);
      } else {
        results[patternHook.index] = this.targetReady().then<NativeHook[] | Waiting<NativeHook[]>>(() =>
          patternHook.found ? patternHook.firstHooks : { waiting: patternHook.firstHooks },
        );
      }
    }

    let stop: () => void = () => {};
    stop = this.moduleWatcher.whenEachLoaded(
      (module) => !resolvedModules.has(module.path) && matching(module).length > 0,
      (module) => {
        resolvedModules.add(module.path);
        const exports = moduleExports(module, false);
        for (const patternHook of matching(module)) {
          if (laterHooks && !laterHooks.wanted(patternHook.index)) {
            patternHook.stopped = true;
            continue;
          }
          const hooks = resolveNativeHookInMatchingModule(patternHook.inputHook, module, exports);
          if (hooks.length === 0) continue;
          logger.debug(`Module '${module.name}' matches '${patternHook.inputHook.module}': ${plural(hooks.length, "function")} to hook.`);
          patternHook.found = true;
          patternHook.stopped = !laterHooks;
          const install = () => {
            this.registerHooks(hooks, source);
            if (patternHook.settled) {
              laterHooks?.add(patternHook.index, hooks);
              return;
            }
            patternHook.settled = true;
            patternHook.settle(hooks);
          };
          if (patternHook.inputHook.hookSettings.early || this.frookyAgent.isTargetReady) install();
          else void this.targetReady().then(install);
        }
        if (patternHooks.every((patternHook) => patternHook.stopped)) stop();
      },
    );
    if (patternHooks.every((patternHook) => patternHook.stopped)) stop();
  }

  // FrookyAgent installs the hooks: right away with `early: true` or after targetReady, else once targetReady resolves
  private resolveInLoadedModule(inputHook: NativeHookDeclaration, module: Module, exports: ModuleExports): Resolution<NativeHook[] | null> {
    const hooks = resolveNativeHook(inputHook, module, exports);
    if (!hooks || inputHook.hookSettings.early || this.frookyAgent.isTargetReady) return hooks;
    return this.targetReady().then(() => hooks);
  }

  // Runs inside the linker while it loads `module`: installs the hooks there with `early: true` or after targetReady,
  // else once targetReady resolves
  private installWhileLoading(
    inputHook: NativeHookDeclaration,
    module: Module,
    exports: ModuleExports,
    source?: string,
  ): NativeHook[] | null | Promise<NativeHook[] | null> {
    const hooks = resolveNativeHook(inputHook, module, exports);
    if (!hooks) return null;
    if (inputHook.hookSettings.early || this.frookyAgent.isTargetReady) {
      this.registerHooks(hooks, source);
      return hooks;
    }
    return this.targetReady().then(() => {
      this.registerHooks(hooks, source);
      return hooks;
    });
  }

  private targetReady(): Promise<void> {
    return this.frookyAgent.targetReady ?? Promise.resolve();
  }

  // Hooks that are already installed, e.g. by resolveHooks() while their module loaded, count as installed.
  public registerHooks(hooks: NativeHook[], source?: string): number {
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      if (this.hookIndex.has(hook)) {
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
      this.hookIndex.add(hook);
      logger.info(`Hooked ${target} at ${hook.symbolAddress}${fromSource(source)}`);
      if (installedHook.callerFilter) logger.debug(installedHook.callerFilter.describe());
      countSuccessfulHooks++;
    }
    return countSuccessfulHooks;
  }

  public describeInstalledHook(hook: NativeHook): string | undefined {
    return this.hookedFunctions.get(hook.symbolAddress.toString())?.hooks.find((installedHook) => installedHook.hook === hook)?.target;
  }

  public otherHooksOnSameFunction(hook: NativeHook): NativeHook[] {
    const hookedFunction = this.hookedFunctions.get(hook.symbolAddress.toString());
    return hookedFunction ? hookedFunction.hooks.map((installedHook) => installedHook.hook).filter((other) => other !== hook) : [];
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
      if (!hookedFunction.hooks.some((installedHook) => installedHook.hook === hook)) this.hookIndex.delete(hook);
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
    if (!hookedFunction.listener) this.moduleWatcher.beforePatch(hookedFunction.address);
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
    } else if (hookedFunction.listener) {
      hookedFunction.listener.detach();
      // see NativeFilteredListener.detach(): updateListener() may attach a listener to the same function next
      Interceptor.flush();
    }
    hookedFunction.native = undefined;
    hookedFunction.listener = undefined;
  }

  // resolves the decoders and argument slots once per hook, not per call
  private prepareHook(hook: NativeHook, target: string): InstalledNativeHook {
    const argDecoders = this.resolveArgDecoders(hook.params);
    // float/double params and return values are in FP registers, not in args[]/returnValue
    const argSlots = planArgSlots(hook.params);
    return {
      hook,
      target,
      inArgDecoders: argDecoders.in,
      outArgDecoders: argDecoders.out,
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
        const effectiveArgs = hasFloatArgs ? collectArgs(args, context, argSlots) : (args as unknown as NativePointer[]);

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
      this.reportHookError(hook, e, `Error during 'onEnter' of ${target}`);
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
      this.reportHookError(hook, e, `Error during 'onLeave' of ${target}`);
    }
  }
}
