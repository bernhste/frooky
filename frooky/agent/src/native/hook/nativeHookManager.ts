import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DecodedArgs, HookManager, ParamDecoder } from "../../shared/hook/hookManager";
import { InputNativeHookNormalized } from "../../shared/inputParsing/inputNativeHookCollection";
import { logger } from "../../shared/logger";
import { PlatformStackTrace } from "../../shared/platformStackTrace";
import { FilterMismatchError } from "../../shared/utils";
import { NativeDecoderResolver } from "../decoders/nativeDecoderResolver";
import { NativeHook } from "./nativeHook";
import { NativeHookEvent } from "./nativeHookEvent";
import { planArgSlots, planFloatRetTypeSlot, readFloatArgBits, usesSeparateFloatRegisterFile } from "./nativeFloatArgs";

export class NativeHookManager extends HookManager<InputNativeHookNormalized, NativeHook, NativePointer> {
  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    super(NativeDecoderResolver, platformStackTrace, frookyAgent);
  }
  public async resolveHooks(inputHooks: InputNativeHookNormalized[], timeout: number): Promise<Promise<NativeHook[] | null>[]> {
    logger.debug(`Resolving native hooks`);

    const uniqueModules: string[] = [...new Map(inputHooks.map((inputHook) => [inputHook.module, inputHook])).keys()];

    return uniqueModules.flatMap((moduleName) => {
      const modulePromise = this.resolveModule(moduleName, timeout).catch((e) => {
        logger.warn(`${e}`);
        return null;
      });

      return inputHooks
        .filter((inputHook) => inputHook.module === moduleName)
        .map(async (inputHook): Promise<NativeHook[] | null> => {
          const resolvedModule = await modulePromise;
          if (!resolvedModule) return null;
          try {
            const symbolAddress = this.resolveSymbol(inputHook.symbol, resolvedModule);
            logger.debug(`Address of function symbol '${inputHook.symbol}' found: ${symbolAddress}.`);
            return [
              {
                module: resolvedModule,
                symbolName: inputHook.symbol,
                symbolAddress,
                params: inputHook.params,
                retType: inputHook.retType,
                hookSettings: inputHook.hookSettings,
                decoderSettings: inputHook.decoderSettings,
              },
            ] as NativeHook[];
          } catch (e) {
            logger.warn(`${e}`);
            return null;
          }
        });
    });
  }

  public registerHooks(hooks: NativeHook[]): number {
    const hookManager = this;
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      let stackTrace: string[];

      // resolve the decoders used for this hook and cache it locally
      let inArgDecoders: ParamDecoder<NativePointer>[];
      let outArgDecoders: ParamDecoder<NativePointer>[];
      if (hook.params) {
        const argDecoders = this.resolveParamDecoders(hook.params);
        inArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "in" || argDecoder.direction === "inout");
        outArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "out" || argDecoder.direction === "inout");
      }

      let retTypeDecoder: Decoder<NativePointer>;
      if (hook.retType) {
        retTypeDecoder = this.resolveRetTypeDecoder(hook.retType);
      }
      let decodedArgs: DecodedArgs = {
        in: [],
        out: [],
      };

      // by-value float/double params/return values aren't in args[]/returnValue at all (see
      // nativeFloatArgs.ts) - computed once per hook since it only depends on the declared
      // params/retType, not on any one invocation.
      const argSlots = planArgSlots(hook.params);
      const floatRetSlot = planFloatRetTypeSlot(hook.retType);

      Interceptor.attach(hook.symbolAddress, {
        onEnter: function (args: NativePointer[]) {
          this.filtered = false;

          try {
            stackTrace = hookManager.stackTrace.build(hook.hookSettings.stackTraceLimit, hook.hookSettings.stackTraceFilter, this.context);
          } catch (e) {
            if (e instanceof FilterMismatchError) {
              this.filtered = true;
              return;
            }
            throw e; // re-throw stackTraceBuilder error
          }

          if (hook.params) {
            // args[] only reflects general-purpose registers; substitute the real bits for
            // by-value float/double params, which live in dedicated FP registers instead - and,
            // on architectures that actually have that separate register file, use each param's
            // own lane-relative index rather than its raw position (see nativeFloatArgs.ts).
            const separateLanes = usesSeparateFloatRegisterFile(this.context);
            const effectiveArgs: NativePointer[] = [];
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

            // decode arguments onEnter
            try {
              decodedArgs.in = hookManager.decodeArgs(effectiveArgs, inArgDecoders);
            } catch (e) {
              if (e instanceof FilterMismatchError) {
                this.filtered = true;
                return;
              }
              throw e; // re-throw arg decoder error
            }

            // save arguments in case they need to be decoded onLeave
            this.savedArgs = effectiveArgs;
          }
        },
        onLeave: function (returnValue: InvocationReturnValue) {
          if (this.filtered) return;
          if (hook.params) {
            try {
              // decode arguments onLeave
              decodedArgs.out = hookManager.decodeArgs(this.savedArgs, outArgDecoders);
            } catch (e) {
              if (e instanceof FilterMismatchError) return;
              throw e;
            }
          }

          // decode ret value
          let decodedRetValue: DecodedValue | undefined;
          if (hook.retType) {
            // returnValue only reflects the general-purpose return register (e.g. RAX); on
            // architectures with a separate FP register file, a float/double return comes back in
            // its own dedicated register instead.
            const floatRetBits = floatRetSlot && usesSeparateFloatRegisterFile(this.context) ? readFloatArgBits(this.context, floatRetSlot) : null;
            decodedRetValue = retTypeDecoder.decode(floatRetBits ?? returnValue);
          }

          // send add to event log
          hookManager.frookyAgent.addEventToLog(new NativeHookEvent(hook, decodedArgs, decodedRetValue, stackTrace));
        },
      });
      countSuccessfulHooks++;
    }
    return countSuccessfulHooks;
  }

  private resolveSymbol(symbol: string, module: Module): NativePointer {
    try {
      logger.debug(`Resolving symbol '${symbol}' in module '${module.name}'.`);
      return module.getExportByName(symbol);
    } catch (e) {
      throw Error(`Skipping hook for native function '${symbol}'. This symbol does not exist in module '${module.name}'.`);
    }
  }

  private async resolveModule(moduleName: string, timeoutSeconds: number): Promise<Module> {
    logger.debug(`Resolving native module ${moduleName} with a timeout of ${timeoutSeconds} seconds.`);
    return this.pollUntilResolved(
      () => {
        try {
          logger.debug(`Trying to resolve module '${moduleName}'.`);
          const module = Process.getModuleByName(moduleName);
          logger.debug(`Module '${moduleName}' successfully loaded.`);
          return module;
        } catch (_) {
          logger.debug(`Module '${moduleName}' not resolved yet.`);
          return null;
        }
      },
      moduleName,
      timeoutSeconds,
    );
  }

  // private buildNativeStackTrace(ctx: CpuContext, limit: number): string[] {
  //   const stackTrace: string[] = [];
  //   try {
  //     const btFull = Thread.backtrace(ctx, Backtracer.FUZZY);
  //     const count = Math.min(limit, btFull.length);
  //     for (let i = 0; i < count; i++) {
  //       try {
  //         stackTrace.push(DebugSymbol.fromAddress(btFull[i]).toString());
  //       } catch (e) {
  //         logger.error(`Error during stack trace capture: ${e}`);
  //       }
  //     }
  //   } catch (e) {
  //     logger.warn(`Native backtrace unavailable: ${e}`);
  //   }
  //   return stackTrace;
  // }
}
