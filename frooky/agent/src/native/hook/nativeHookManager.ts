import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DecodedArgs, HookManager, ParamDecoder } from "../../shared/hook/hookManager";
import { describeNativeTarget, InputNativeHookNormalized } from "../../shared/inputParsing/inputNativeHookCollection";
import { logger } from "../../shared/logger";
import { PlatformStackTrace } from "../../shared/platformStackTrace";
import { FilterMismatchError, fromSource, plural } from "../../shared/utils";
import { NativeDecoderResolver } from "../decoders/nativeDecoderResolver";
import { planArgSlots, planFloatRetTypeSlot, readFloatArgBits, usesSeparateFloatRegisterFile } from "./nativeFloatArgs";
import { NativeHook } from "./nativeHook";
import { NativeHookEvent } from "./nativeHookEvent";

// the most bytes the Interceptor overwrites at a hooked address (an absolute jump on x86_64 or arm64)
const INTERCEPTOR_PATCH_BYTES = 16;

export class NativeHookManager extends HookManager<InputNativeHookNormalized, NativeHook, NativePointer> {
  private installedHooks = new Set<NativeHook>();
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
    const hookManager = this;
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      const target = describeNativeTarget(hook.moduleName, { symbol: hook.symbolName, offset: hook.offset });

      // resolved once per hook, not per call
      let inArgDecoders: ParamDecoder<NativePointer>[] = [];
      let outArgDecoders: ParamDecoder<NativePointer>[] = [];
      if (hook.params) {
        const argDecoders = this.resolveParamDecoders(hook.params);
        inArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "in" || argDecoder.direction === "inout");
        outArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "out" || argDecoder.direction === "inout");
      }

      let retTypeDecoder: Decoder<NativePointer>;
      if (hook.retType) {
        retTypeDecoder = this.resolveRetTypeDecoder(hook.retType);
      }
      // float/double params and return values are in FP registers, not in args[]/returnValue
      const argSlots = planArgSlots(hook.params);
      const hasFloatArgs = argSlots.some((slot) => slot.kind === "float");
      const floatRetSlot = planFloatRetTypeSlot(hook.retType);

      // per-call state lives on `this` (Frida's invocation context): another thread or a recursive call can
      // enter the hook between onEnter and onLeave
      const callbacks: InvocationListenerCallbacks = {
        onEnter: function (args: NativePointer[]) {
          const tid = Process.getCurrentThreadId();
          if (hookManager.activeThreads.has(tid)) {
            this.filtered = true;
            return;
          }
          hookManager.activeThreads.add(tid);
          try {
            this.filtered = false;
            this.argsIn = [];

            if (hook.params) {
              let effectiveArgs: NativePointer[];
              if (hasFloatArgs) {
                // args[] only holds general-purpose registers, float/double params are read from FP registers
                const separateLanes = usesSeparateFloatRegisterFile(this.context);
                effectiveArgs = new Array(hook.params.length);
                for (let i = 0; i < hook.params.length; i++) {
                  const slot = argSlots[i];
                  if (slot.kind === "float" && separateLanes) {
                    effectiveArgs[i] = readFloatArgBits(this.context, slot) ?? ptr(0);
                  } else if (slot.kind === "float") {
                    effectiveArgs[i] = args[i];
                  } else {
                    effectiveArgs[i] = separateLanes ? args[slot.argIndex] : args[i];
                  }
                }
              } else {
                effectiveArgs = args;
              }

              if (inArgDecoders.length > 0) {
                try {
                  this.argsIn = hookManager.decodeArgs(effectiveArgs, inArgDecoders, target);
                } catch (e) {
                  if (e instanceof FilterMismatchError) {
                    this.filtered = true;
                    return;
                  }
                  throw e;
                }
              }

              if (outArgDecoders.length > 0) {
                // for `out` params decoded onLeave
                this.savedArgs = effectiveArgs;
              }
            }

            try {
              this.stackTrace = hookManager.stackTrace.build(hook.hookSettings.maxStackFrames, hook.hookSettings.stackTraceFilter, this.context);
            } catch (e) {
              if (e instanceof FilterMismatchError) {
                this.filtered = true;
                return;
              }
              throw e;
            }
          } finally {
            hookManager.activeThreads.delete(tid);
          }
        },
        onLeave: function (returnValue: InvocationReturnValue) {
          if (this.filtered) return;
          const tid = Process.getCurrentThreadId();
          if (hookManager.activeThreads.has(tid)) return;
          hookManager.activeThreads.add(tid);
          try {
            const decodedArgs: DecodedArgs = { in: this.argsIn ?? [], out: [] };
            if (outArgDecoders.length > 0) {
              try {
                decodedArgs.out = hookManager.decodeArgs(this.savedArgs, outArgDecoders, target);
              } catch (e) {
                if (e instanceof FilterMismatchError) return;
                throw e;
              }
            }

            let decodedRetValue: DecodedValue | undefined;
            if (hook.retType) {
              // returnValue is the general-purpose return register, a float/double is returned in an FP register
              const floatRetBits = floatRetSlot && usesSeparateFloatRegisterFile(this.context) ? readFloatArgBits(this.context, floatRetSlot) : null;
              decodedRetValue = hookManager.decodeValue(retTypeDecoder, floatRetBits ?? returnValue, `${target} return value`);
            }

            hookManager.frookyAgent.addEventToLog(new NativeHookEvent(hook, decodedArgs, decodedRetValue, this.stackTrace));
          } finally {
            hookManager.activeThreads.delete(tid);
          }
        },
      };

      try {
        hook.listener = Interceptor.attach(hook.symbolAddress, callbacks);
        this.installedHooks.add(hook);
      } catch (e) {
        logger.warn(`Failed to hook ${target}: ${e}`);
        continue;
      }
      logger.info(`Hooked ${target} at ${hook.symbolAddress}${fromSource(source)}`);
      countSuccessfulHooks++;
    }
    return countSuccessfulHooks;
  }

  public unregisterHooks(hooks: NativeHook[]): void {
    for (const hook of hooks) {
      hook.listener?.detach();
      hook.listener = undefined;
      this.installedHooks.delete(hook);
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
