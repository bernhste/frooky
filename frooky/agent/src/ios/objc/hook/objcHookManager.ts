import ObjC from "frida-objc-bridge";
import { FrookyAgent } from "../../../FrookyAgent";
import { planArgSlots, planFloatRetTypeSlot, readFloatArgBits, usesSeparateFloatRegisterFile } from "../../../native/hook/nativeFloatArgs";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { Param } from "../../../shared/decoders/decodable";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS, HOOK_LOOKUP_INTERVAL_MS } from "../../../shared/defaultValues";
import { DecodedArgs, HookManager, ParamDecoder } from "../../../shared/hook/hookManager";
import { normalizeInputParams, normalizeInputRetTypeSettings } from "../../../shared/inputParsing/inputDecodableTypes";
import { InputObjcHookNormalized } from "../../../shared/inputParsing/inputObjcHookCollection";
import { logger } from "../../../shared/logger";
import { PlatformStackTrace } from "../../../shared/platformStackTrace";
import { FilterMismatchError, fromSource, plural, wildcardPatternToRegExp } from "../../../shared/utils";
import { ObjcDecoderResolver, objcFloatType } from "../decoders/objcDecoderResolver";
import { parseObjcMethodEncoding } from "../objcTypeEncoding";
import { ObjcHook } from "./objcHook";
import { ObjcHookEvent } from "./objcHookEvent";

// `self` and `_cmd` are the first two arguments of every method implementation
const IMPLICIT_ARG_COUNT = 2;

// e.g. `-[NSData length]`
function describeObjcHook(hook: ObjcHook): string {
  return `${hook.methodType === "class" ? "+" : "-"}[${hook.objcClass} ${hook.selector}]`;
}

// Hooks the implementations (IMP) of Objective-C methods with the Interceptor. The ObjC bridge is only used
// to look up classes and methods and to read objects, the decoders work on raw pointers.
export class ObjcHookManager extends HookManager<InputObjcHookNormalized, ObjcHook, NativePointer> {
  // threads inside a hook callback, so methods called while decoding (e.g. `-description`) aren't captured
  private activeThreads = new Set<number>();

  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    super(ObjcDecoderResolver, platformStackTrace, frookyAgent);
  }

  async resolveHooks(inputHooks: InputObjcHookNormalized[], timeout: number, source?: string): Promise<Promise<ObjcHook[] | null>[]> {
    logger.info(
      `Resolving ${plural(inputHooks.length, "Objective-C hook")} in ${plural(new Set(inputHooks.map((h) => h.objcClass)).size, "class", "classes")}${fromSource(source)}`,
    );

    // each class is resolved once, no matter how many hooks target it
    const objcClassPromises = new Map<string, Promise<ObjC.Object[]>>();
    return inputHooks.map(async (inputHook): Promise<ObjcHook[] | null> => {
      let objcClassesPromise = objcClassPromises.get(inputHook.objcClass);
      if (!objcClassesPromise) {
        objcClassesPromise = this.resolveObjcClass(inputHook.objcClass, timeout).catch((e) => {
          logger.warn(e instanceof Error ? e.message : String(e));
          return [] as ObjC.Object[];
        });
        objcClassPromises.set(inputHook.objcClass, objcClassesPromise);
      }
      const resolvedClasses = await objcClassesPromise;
      if (resolvedClasses.length === 0) return null;

      const hooks: ObjcHook[] = [];
      for (const resolvedClass of resolvedClasses) {
        try {
          hooks.push(...this.resolveMethods(resolvedClass, inputHook));
        } catch (e) {
          logger.warn(e instanceof Error ? e.message : String(e));
        }
      }
      return hooks.length > 0 ? hooks : null;
    });
  }

  registerHooks(hooks: ObjcHook[], source?: string): number {
    const hookManager = this;
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      const target = describeObjcHook(hook);

      // resolved once per hook, not per call
      const argDecoders = this.resolveParamDecoders(hook.params);
      const inArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "in" || argDecoder.direction === "inout");
      const outArgDecoders: ParamDecoder<NativePointer>[] = argDecoders.filter(
        (argDecoder) => argDecoder.direction === "out" || argDecoder.direction === "inout",
      );
      const retTypeDecoder: Decoder<NativePointer> | undefined = hook.retType ? this.resolveRetTypeDecoder(hook.retType) : undefined;

      // float/double params and return values are in FP registers, not in args[]/returnValue
      const argSlots = planArgSlots(hook.params.map((param) => ({ ...param, type: objcFloatType(param.type) ?? param.type })));
      const floatRetSlot = planFloatRetTypeSlot(hook.retType && { type: objcFloatType(hook.retType.type) ?? hook.retType.type });
      const separateFloatLanes = usesSeparateFloatRegisterFile();
      const needsStackTrace = hook.hookSettings.maxStackFrames > 0 || hook.hookSettings.stackTraceFilter.length > 0;

      // per-call state lives on `this` (Frida's invocation context): another thread or a recursive call can
      // enter the hook between onEnter and onLeave
      const callbacks: InvocationListenerCallbacks = {
        onEnter(args: NativePointer[]) {
          const tid = Process.getCurrentThreadId();
          if (hookManager.activeThreads.has(tid)) {
            this.filtered = true;
            return;
          }
          hookManager.activeThreads.add(tid);
          try {
            this.filtered = false;
            this.receiver = args[0];
            // Frida's InvocationArgs proxy is only valid during onEnter, so the explicit arguments are copied.
            // `self` and `_cmd` take the first two general-purpose registers.
            this.explicitArgs = hook.params.map((_, i): NativePointer => {
              const slot = argSlots[i];
              if (slot.kind === "float" && separateFloatLanes) return readFloatArgBits(this.context, slot) ?? ptr(0);
              if (slot.kind === "float" || !separateFloatLanes) return args[IMPLICIT_ARG_COUNT + i];
              return args[IMPLICIT_ARG_COUNT + slot.argIndex];
            });

            try {
              this.argsIn = inArgDecoders.length > 0 ? hookManager.decodeArgs(this.explicitArgs, inArgDecoders, target) : [];
            } catch (e) {
              this.filtered = true;
              if (!(e instanceof FilterMismatchError)) {
                logger.error(`Decoder error during 'onEnter' argument decoding of ${target}: ${e}`);
              }
              return;
            }

            try {
              const ctx = needsStackTrace ? this.context : undefined;
              this.stackTrace = hookManager.stackTrace.build(hook.hookSettings.maxStackFrames, hook.hookSettings.stackTraceFilter, ctx);
            } catch (e) {
              this.filtered = true;
              if (e instanceof FilterMismatchError) return;
              throw e;
            }
          } finally {
            hookManager.activeThreads.delete(tid);
          }
        },
        onLeave(returnValue: InvocationReturnValue) {
          if (this.filtered) return;
          const tid = Process.getCurrentThreadId();
          if (hookManager.activeThreads.has(tid)) return;
          hookManager.activeThreads.add(tid);
          try {
            const decodedArgs: DecodedArgs = { in: this.argsIn, out: [] };
            if (outArgDecoders.length > 0) {
              try {
                decodedArgs.out = hookManager.decodeArgs(this.explicitArgs, outArgDecoders, target);
              } catch (e) {
                if (!(e instanceof FilterMismatchError)) {
                  logger.error(`Decoder error during 'onLeave' argument decoding of ${target}: ${e}`);
                }
                return;
              }
            }

            let decodedRetValue: DecodedValue | undefined;
            if (retTypeDecoder) {
              try {
                // returnValue is the general-purpose return register, a float/double is returned in an FP register
                const floatRetBits = floatRetSlot && separateFloatLanes ? readFloatArgBits(this.context, floatRetSlot) : null;
                decodedRetValue = hookManager.decodeValue(retTypeDecoder, floatRetBits ?? returnValue, `${target} return value`);
              } catch (e) {
                logger.error(`Decoder error during return value decoding of ${target}: ${e}`);
                return;
              }
            }

            const instance = hook.methodType === "instance" ? (this.receiver as NativePointer).toString() : undefined;
            hookManager.frookyAgent.addEventToLog(new ObjcHookEvent(hook, instance, decodedArgs, decodedRetValue, this.stackTrace));
          } finally {
            hookManager.activeThreads.delete(tid);
          }
        },
      };

      try {
        hook.listener = Interceptor.attach(hook.implementation, callbacks);
      } catch (e) {
        logger.warn(`Failed to hook ${target}: ${e}`);
        continue;
      }
      logger.info(`Hooked ${target}${fromSource(source)}`);
      countSuccessfulHooks++;
    }
    return countSuccessfulHooks;
  }

  unregisterHooks(hooks: ObjcHook[]): void {
    for (const hook of hooks) {
      hook.listener?.detach();
      hook.listener = undefined;
    }
  }

  // Polls until the class is loaded, or for a wildcard pattern (e.g. `NS*URL*`, `*` matching any characters)
  // until at least one loaded class matches. Throws on timeout.
  private async resolveObjcClass(objcClassName: string, timeoutSeconds: number): Promise<ObjC.Object[]> {
    logger.debug(`Resolving Objective-C class ${objcClassName} with a timeout of ${timeoutSeconds} seconds.`);

    if (objcClassName.includes("*")) {
      const pattern = wildcardPatternToRegExp(objcClassName);
      return this.pollUntilResolved(
        () => {
          const resolvedClasses = ObjcHookManager.getLoadedClassNames()
            .filter((className) => pattern.test(className))
            .map((className) => ObjC.classes[className]);
          if (resolvedClasses.length === 0) return null;
          logger.debug(`${resolvedClasses.length} Objective-C class(es) matching wildcard pattern '${objcClassName}' resolved.`);
          return resolvedClasses;
        },
        `Objective-C class matching '${objcClassName}'`,
        timeoutSeconds,
      );
    }

    return this.pollUntilResolved(
      () => {
        const resolvedClass = ObjC.classes[objcClassName];
        return resolvedClass ? [resolvedClass] : null;
      },
      `Objective-C class '${objcClassName}'`,
      timeoutSeconds,
    );
  }

  // Enumerating ObjC.classes takes long (thousands of classes), so all wildcard lookups of one poll interval
  // share its result.
  private static getLoadedClassNames(): string[] {
    const now = Date.now();
    if (!this.loadedClassNamesCache || now >= this.loadedClassNamesCache.expiresAt) {
      this.loadedClassNamesCache = { names: Object.keys(ObjC.classes), expiresAt: now + HOOK_LOOKUP_INTERVAL_MS };
      logger.debug(`Loaded class list cache miss: enumerated ${this.loadedClassNamesCache.names.length} loaded classes`);
    }
    return this.loadedClassNamesCache.names;
  }

  private static loadedClassNamesCache: { names: string[]; expiresAt: number } | null = null;

  // The methods the class itself implements for a `-sel:`, `+sel:` or `sel:` declaration.
  private resolveMethods(objcClass: ObjC.Object, inputHook: InputObjcHookNormalized): ObjcHook[] {
    const [, kind, selector] = /^\s*([+-])?\s*(.+?)\s*$/.exec(inputHook.method)!;
    const methodNames = objcClass.$ownMethods.filter((name) => name.slice(2) === selector && (!kind || name[0] === kind));
    if (methodNames.length === 0) {
      throw Error(`Skipping hook for '${inputHook.method}'. This method is not implemented by class '${objcClass.$className}'.`);
    }

    return methodNames.map((methodName) => {
      const method: ObjC.ObjectMethod = objcClass[methodName];
      const signature = parseObjcMethodEncoding(method.types);
      const decoderSettings = inputHook.decoderSettings ?? DEFAULT_DECODER_SETTINGS;
      const declaringClass = objcClass.$className;

      // declared params replace the types read from the type encoding
      let params: Param[];
      if (inputHook.params) {
        if (inputHook.params.length !== signature.argTypes.length) {
          throw Error(
            `Skipping hook for '${methodName}' of class '${declaringClass}'. ` +
              `${inputHook.params.length} params declared, but the method takes ${signature.argTypes.length} (without self and _cmd).`,
          );
        }
        params = normalizeInputParams(inputHook.params).map((param) => ({ ...param, declaringClass }));
      } else {
        params = signature.argTypes.map((type) => ({ type, direction: "in", declaringClass, settings: decoderSettings }));
      }

      return {
        objcClass: declaringClass,
        selector,
        methodType: methodName[0] === "+" ? "class" : "instance",
        implementation: method.implementation,
        params,
        retType:
          signature.returnType === "void"
            ? undefined
            : {
                type: signature.returnType,
                declaringClass,
                settings: inputHook.retType ? normalizeInputRetTypeSettings(inputHook.retType, decoderSettings) : decoderSettings,
              },
        hookSettings: inputHook.hookSettings ?? DEFAULT_HOOK_SETTINGS,
        decoderSettings,
      } satisfies ObjcHook;
    });
  }
}
