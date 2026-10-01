import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DecodedArgs, HookManager, ParamDecoder } from "../../shared/hook/hookManager";
import { describeNativeTarget, InputNativeHookNormalized } from "../../shared/inputParsing/inputNativeHookCollection";
import { logger } from "../../shared/logger";
import { EMPTY_STACK_TRACE, HookStackTrace, PlatformStackTrace } from "../../shared/platformStackTrace";
import { FilterMismatchError, fromSource, plural } from "../../shared/utils";
import { NativeDecoderResolver } from "../decoders/nativeDecoderResolver";
import { planArgSlots, planFloatRetTypeSlot, readFloatArgBits, usesSeparateFloatRegisterFile } from "./nativeFloatArgs";
import { NativeHook } from "./nativeHook";
import { addressHashCode, NativeHookEvent } from "./nativeHookEvent";

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
  needsStackTrace: boolean | undefined;
  // the same for every call
  hashCode: string;
};

type HookedFunction = { listener?: InvocationListener; hooks: InstalledNativeHook[] };

// what a hook captured in onEnter
type NativeHookCall = {
  installedHook: InstalledNativeHook;
  argsIn: DecodedValue[];
  // the arguments for `out` params, as InvocationArguments is only valid during onEnter
  savedArgs?: NativePointer[];
  stackTrace: HookStackTrace;
};

export class NativeHookManager extends HookManager<InputNativeHookNormalized, NativeHook, NativePointer> {
  private installedHooks = new Set<NativeHook>();
  // the hooks installed on a function, keyed by its address. Several configs can hook the same function and each
  // records its own event per call.
  private readonly hookedFunctions = new Map<string, HookedFunction>();
  // threads inside a hook callback, so calls made while decoding aren't captured
  private activeThreads = new Set<number>();

  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    super(NativeDecoderResolver, platformStackTrace, frookyAgent);
  }
  public async resolveHooks(inputHooks: InputNativeHookNormalized[], timeout: number, source?: string): Promise<Promise<NativeHook[] | null>[]> {
    logger.info(
      `Resolving ${plural(inputHooks.length, "native hook")} in ${plural(new Set(inputHooks.map((h) => h.module)).size, "module")}${fromSource(source)}`,
    );

    // each module is resolved once, no matter how many hooks target it
    const modulePromises = new Map<string, Promise<Module | null>>();
    return inputHooks.map(async (inputHook): Promise<NativeHook[] | null> => {
      const target = describeNativeTarget(inputHook.module, inputHook);
      let modulePromise = modulePromises.get(inputHook.module);
      if (modulePromise) {
        logger.debug(`Module lookup cache hit: ${inputHook.module} (for ${target})`);
      } else {
        logger.debug(`Module lookup cache miss: ${inputHook.module} (for ${target})`);
        modulePromise = this.resolveModule(inputHook.module, timeout).catch((e) => {
          logger.warn(e instanceof Error ? e.message : String(e));
          return null;
        });
        modulePromises.set(inputHook.module, modulePromise);
      }
      const resolvedModule = await modulePromise;
      if (!resolvedModule) return null;
      try {
        const symbolAddress =
          inputHook.symbol !== undefined
            ? this.resolveSymbol(inputHook.symbol, resolvedModule)
            : this.resolveModuleOffset(String(inputHook.offset), resolvedModule);
        logger.debug(`Address of function ${target} found: ${symbolAddress}.`);
        return [
          {
            module: resolvedModule,
            moduleName: resolvedModule.name,
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
    });
  }

  public registerHooks(hooks: NativeHook[], source?: string): number {
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      const target = describeNativeTarget(hook.moduleName, { symbol: hook.symbolName, offset: hook.offset });
      const installedHook = this.prepareHook(hook, target);

      const key = hook.symbolAddress.toString();
      let hookedFunction = this.hookedFunctions.get(key);
      if (!hookedFunction) {
        const newHookedFunction: HookedFunction = { hooks: [] };
        try {
          newHookedFunction.listener = Interceptor.attach(hook.symbolAddress, this.createDispatcher(newHookedFunction));
        } catch (e) {
          logger.warn(`Failed to hook ${target}: ${e}`);
          continue;
        }
        hookedFunction = newHookedFunction;
        this.hookedFunctions.set(key, hookedFunction);
      }
      // copied on write: a call in progress keeps running the hooks it entered
      hookedFunction.hooks = [...hookedFunction.hooks, installedHook];
      hook.listener = hookedFunction.listener;
      this.installedHooks.add(hook);
      logger.info(`Hooked ${target} at ${hook.symbolAddress}${fromSource(source)}`);
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

      hookedFunction.hooks = hookedFunction.hooks.filter((_, i) => i !== index);
      hook.listener = undefined;
      if (!hookedFunction.hooks.some((installedHook) => installedHook.hook === hook)) this.installedHooks.delete(hook);
      if (hookedFunction.hooks.length > 0) continue;

      this.hookedFunctions.delete(key);
      hookedFunction.listener?.detach();
    }
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
      needsStackTrace:
        hook.hookSettings.platformStackTrace ||
        hook.hookSettings.nativeStackTrace ||
        (hook.hookSettings.stackTraceFilter && hook.hookSettings.stackTraceFilter.length > 0),
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
        const tid = Process.getCurrentThreadId();
        if (hookManager.activeThreads.has(tid)) return;
        hookManager.activeThreads.add(tid);
        try {
          const calls: NativeHookCall[] = [];
          for (const installedHook of hookedFunction.hooks) {
            const call = hookManager.enterHook(installedHook, args, this.context);
            if (call) calls.push(call);
          }
          if (calls.length > 0) this.calls = calls;
        } finally {
          hookManager.activeThreads.delete(tid);
        }
      },
      onLeave: function (returnValue: InvocationReturnValue) {
        const calls: NativeHookCall[] | undefined = this.calls;
        if (!calls) return;
        const tid = Process.getCurrentThreadId();
        if (hookManager.activeThreads.has(tid)) return;
        hookManager.activeThreads.add(tid);
        try {
          for (const call of calls) {
            hookManager.leaveHook(call, returnValue, this.context);
          }
        } finally {
          hookManager.activeThreads.delete(tid);
        }
      },
    };
  }

  // null if the stackTraceFilter or an argFilter doesn't match, or decoding fails
  private enterHook(installedHook: InstalledNativeHook, args: InvocationArguments, context: CpuContext): NativeHookCall | null {
    const { hook, target, inArgDecoders, outArgDecoders, argSlots, hasFloatArgs } = installedHook;
    try {
      const call: NativeHookCall = { installedHook, argsIn: [], stackTrace: EMPTY_STACK_TRACE };
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
          call.argsIn = this.decodeArgs(effectiveArgs, inArgDecoders, target);
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
        call.stackTrace = this.stackTrace.build(hook.hookSettings, hook.hookSettings.nativeStackTrace ? context : undefined);
      }
      return call;
    } catch (e) {
      if (!(e instanceof FilterMismatchError)) {
        logger.error(`Error during 'onEnter' of ${target}: ${e}`);
      }
      return null;
    }
  }

  private leaveHook(call: NativeHookCall, returnValue: InvocationReturnValue, context: CpuContext): void {
    const { hook, target, outArgDecoders, retTypeDecoder, floatRetSlot } = call.installedHook;
    try {
      // first, as `out` parameters with `decoderArgs: { length: $ret }` need it
      let decodedRetValue: DecodedValue | undefined;
      if (retTypeDecoder) {
        // returnValue is the general-purpose return register, a float/double is returned in an FP register
        const floatRetBits = floatRetSlot && usesSeparateFloatRegisterFile() ? readFloatArgBits(context, floatRetSlot) : null;
        decodedRetValue = this.decodeValue(retTypeDecoder, floatRetBits ?? returnValue, `${target} return value`);
      }

      const decodedArgs: DecodedArgs = { in: call.argsIn, out: [] };
      if (outArgDecoders.length > 0) {
        decodedArgs.out = this.decodeArgs(call.savedArgs!, outArgDecoders, target, decodedRetValue);
      }

      this.frookyAgent.addEventToLog(new NativeHookEvent(hook, call.installedHook.hashCode, decodedArgs, decodedRetValue, call.stackTrace));
    } catch (e) {
      if (!(e instanceof FilterMismatchError)) {
        logger.error(`Error during 'onLeave' of ${target}: ${e}`);
      }
    }
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

  private resolveSymbol(symbol: string, module: Module): NativePointer {
    try {
      return module.getExportByName(symbol);
    } catch (e) {
      throw Error(`Skipping hook for '${symbol}'. This symbol does not exist in module '${module.name}'.`);
    }
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

  private async resolveModule(moduleName: string, timeoutSeconds: number): Promise<Module> {
    logger.debug(`Resolving native module ${moduleName} with a timeout of ${timeoutSeconds} seconds.`);
    return this.pollUntilResolved(
      () => {
        try {
          const module = Process.getModuleByName(moduleName);
          logger.debug(`Module '${moduleName}' successfully loaded.`);
          return module;
        } catch (_) {
          return null;
        }
      },
      `Module '${moduleName}'`,
      timeoutSeconds,
    );
  }
}
