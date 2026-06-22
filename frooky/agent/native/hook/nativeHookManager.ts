import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DecodedArgs, HookManager, ParamDecoder } from "../../shared/hook/hookManager";
import { InputNativeHookNormalized } from "../../shared/inputParsing/inputNativeHookGroup";
import { NativeDecoderResolver } from "../decoders/nativeDecoderResolver";
import { NativeHook } from "./nativeHook";
import { NativeHookEvent } from "./nativeHookEvent";

export class NativeHookManager extends HookManager<InputNativeHookNormalized, NativeHook, NativePointer> {
  constructor() {
    super(NativeDecoderResolver);
  }

  public async resolveHooks(inputHooks: InputNativeHookNormalized[], timeout: number): Promise<Promise<NativeHook[] | null>[]> {
    frooky.log.debug(`Resolving native hooks`);

    const uniqueModules: string[] = [...new Map(inputHooks.map((inputHook) => [inputHook.module, inputHook])).keys()];

    return uniqueModules.flatMap((moduleName) => {
      const modulePromise = this.resolveModule(moduleName, timeout).catch((e) => {
        frooky.log.warn(`${e}`);
        return null;
      });

      return inputHooks
        .filter((inputHook) => inputHook.module === moduleName)
        .map(async (inputHook): Promise<NativeHook[] | null> => {
          const resolvedModule = await modulePromise;
          if (!resolvedModule) return null;
          try {
            const symbolAddress = this.resolveSymbol(inputHook.symbol, resolvedModule);
            frooky.log.debug(`Address of function symbol '${inputHook.symbol}' found: ${symbolAddress}.`);
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
            frooky.log.warn(`${e}`);
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

      Interceptor.attach(hook.symbolAddress, {
        onEnter: function (args: NativePointer[]) {
          // build stack trace
          const stackTraceLimit: number = hook.hookSettings.stackTraceLimit;
          stackTrace = hookManager.buildNativeStackTrace(this.context, stackTraceLimit);

          if (hook.params) {
            // decode arguments onEnter
            this.savedArgs = [];
            for (let i = 0; i < hook.params.length; i++) {
              this.savedArgs[i] = args[i];
            }
            decodedArgs.in = hookManager.decodeArgs(args, inArgDecoders);
          }
        },
        onLeave: function (returnValue: InvocationReturnValue) {
          if (hook.params) {
            // decode arguments onExit
            decodedArgs.out = hookManager.decodeArgs(this.savedArgs, outArgDecoders);
          }

          let decodedRetValue: DecodedValue | undefined;
          if (hook.retType) {
            console.log("retType");
            decodedRetValue = retTypeDecoder.decode(returnValue);
          }

          frooky.addEventToLog(new NativeHookEvent(hook, decodedArgs, decodedRetValue, stackTrace));
        },
      });
      countSuccessfulHooks++;
    }
    return countSuccessfulHooks;
  }

  private resolveSymbol(symbol: string, module: Module): NativePointer {
    try {
      frooky.log.debug(`Resolving symbol '${symbol}' in module '${module.name}'.`);
      return module.getExportByName(symbol);
    } catch (e) {
      throw Error(`Skipping hook for native function '${symbol}'. This symbol does not exist in module '${module.name}'.`);
    }
  }

  private async resolveModule(moduleName: string, timeoutSeconds: number): Promise<Module> {
    frooky.log.debug(`Resolving native module ${moduleName} with a timeout of ${timeoutSeconds} seconds.`);
    return this.pollUntilResolved(
      () => {
        try {
          frooky.log.debug(`Trying to resolve module '${moduleName}'.`);
          const module = Process.getModuleByName(moduleName);
          frooky.log.debug(`Module '${moduleName}' successfully loaded.`);
          return module;
        } catch (_) {
          frooky.log.debug(`Module '${moduleName}' not resolved yet.`);
          return null;
        }
      },
      moduleName,
      timeoutSeconds,
    );
  }

  private buildNativeStackTrace(ctx: CpuContext, limit: number): string[] {
    const stackTrace: string[] = [];
    try {
      const btFull = Thread.backtrace(ctx, Backtracer.FUZZY);
      const count = Math.min(limit, btFull.length);
      for (let i = 0; i < count; i++) {
        try {
          stackTrace.push(DebugSymbol.fromAddress(btFull[i]).toString());
        } catch (e) {
          frooky.log.error(`Error during stack trace capture: ${e}`);
        }
      }
    } catch (e) {
      frooky.log.warn(`Native backtrace unavailable: ${e}`);
    }
    return stackTrace;
  }
}
