import ObjC from "frida-objc-bridge";
import { FrookyAgent } from "../../../FrookyAgent";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { Param } from "../../../shared/decoders/decodable";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS, HOOK_LOOKUP_INTERVAL_MS } from "../../../shared/defaultValues";
import { DecodedArgs, HookManager } from "../../../shared/hook/hookManager";
import { normalizeInputParam, normalizeInputRetTypeSettings } from "../../../shared/inputParsing/inputDecodableTypes";
import { InputObjcHookNormalized } from "../../../shared/inputParsing/inputObjcHookCollection";
import { logger } from "../../../shared/logger";
import { PlatformStackTrace } from "../../../shared/platformStackTrace";
import { FilterMismatchError, wildcardPatternToRegExp } from "../../../shared/utils";
import { planArgSlots, planFloatRetTypeSlot, readFloatArgBits, usesSeparateFloatRegisterFile } from "../../../native/hook/nativeFloatArgs";
import { ObjcDecoderResolver, objcFloatType } from "../decoders/objcDecoderResolver";
import { parseObjcMethodEncoding } from "../objcTypeEncoding";
import { ObjcHook } from "./objcHook";
import { ObjcHookEvent } from "./objcHookEvent";

// `self` and `_cmd` are passed as the first two arguments of every method implementation
const IMPLICIT_ARG_COUNT = 2;

/**
 * Resolves Objective-C classes and methods and hooks their implementations (IMP) using the Interceptor.
 * Uses the Frida ObjC bridge only to look up classes and methods and to read objects. The decoders work on raw pointers.
 */
export class ObjcHookManager extends HookManager<InputObjcHookNormalized, ObjcHook, NativePointer> {
  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    super(ObjcDecoderResolver, platformStackTrace, frookyAgent);
  }

  async resolveHooks(inputHooks: InputObjcHookNormalized[], timeout: number): Promise<Promise<ObjcHook[] | null>[]> {
    logger.debug(`Resolving Objective-C hooks`);

    const uniqueClasses: string[] = [...new Set(inputHooks.map((inputHook) => inputHook.objcClass))];
    return uniqueClasses.flatMap((objcClass) => {
      const objcClassesPromise = this.resolveObjcClass(objcClass, timeout).catch((e) => {
        logger.warn(`${e}`);
        return [] as ObjC.Object[];
      });
      return inputHooks
        .filter((inputHook) => inputHook.objcClass === objcClass)
        .map(async (inputHook): Promise<ObjcHook[] | null> => {
          const resolvedClasses = await objcClassesPromise;
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
    });
  }

  registerHooks(hooks: ObjcHook[]): number {
    const hookManager = this;
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      // resolve the decoders used for this hook and cache them locally
      const argDecoders = this.resolveParamDecoders(hook.params);
      const inArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "in" || argDecoder.direction === "inout");
      const outArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "out" || argDecoder.direction === "inout");
      const retTypeDecoder: Decoder<NativePointer> | undefined = hook.retType ? this.resolveRetTypeDecoder(hook.retType) : undefined;
      const hookName = `${hook.methodType === "class" ? "+" : "-"}[${hook.objcClass} ${hook.selector}]`;

      // by-value float/double params/return values are not in args[]/returnValue, see nativeFloatArgs.ts.
      // Computed once per hook, as it only depends on the declared types.
      const argSlots = planArgSlots(hook.params.map((param) => ({ ...param, type: objcFloatType(param.type) ?? param.type })));
      const floatRetSlot = planFloatRetTypeSlot(hook.retType && { type: objcFloatType(hook.retType.type) ?? hook.retType.type });

      // state is kept per invocation on `this`, as the same method can run on multiple threads at once
      Interceptor.attach(hook.implementation, {
        onEnter(args: NativePointer[]) {
          this.filtered = false;

          try {
            this.stackTrace = hookManager.stackTrace.build(hook.hookSettings.stackTraceLimit, hook.hookSettings.stackTraceFilter, this.context);
          } catch (e) {
            if (e instanceof FilterMismatchError) {
              this.filtered = true;
              return;
            }
            throw e; // re-throw stack trace build error
          }

          // strip `self` and `_cmd`
          this.receiver = args[0];
          // args[] only holds the general-purpose registers. Where the architecture has a separate FP register file,
          // each param is looked up in its own lane. `self` and `_cmd` always take the first two general-purpose slots.
          const separateLanes = usesSeparateFloatRegisterFile(this.context);
          this.explicitArgs = hook.params.map((_, i): NativePointer => {
            const slot = argSlots[i];
            if (slot.kind === "float" && separateLanes) return readFloatArgBits(this.context, slot) ?? ptr(0);
            if (slot.kind === "float" || !separateLanes) return args[IMPLICIT_ARG_COUNT + i];
            return args[IMPLICIT_ARG_COUNT + slot.argIndex];
          });
          this.decodedArgs = { in: [], out: [] } as DecodedArgs;

          // decode arguments onEnter
          try {
            this.decodedArgs.in = hookManager.decodeArgs(this.explicitArgs, inArgDecoders);
          } catch (e) {
            if (e instanceof FilterMismatchError) {
              this.filtered = true;
              return;
            }
            logger.error(`Decoder error during 'onEnter' argument decoding of ${hookName}: ${e}`);
            this.filtered = true;
          }
        },
        onLeave(returnValue: InvocationReturnValue) {
          if (this.filtered) return;

          // decode arguments onLeave
          try {
            this.decodedArgs.out = hookManager.decodeArgs(this.explicitArgs, outArgDecoders);
          } catch (e) {
            if (!(e instanceof FilterMismatchError)) {
              logger.error(`Decoder error during 'onLeave' argument decoding of ${hookName}: ${e}`);
            }
            return;
          }

          // decode the return value
          let decodedRetValue: DecodedValue | undefined;
          try {
            // a float/double return value comes back in its own FP register on architectures that have one
            const floatRetBits = floatRetSlot && usesSeparateFloatRegisterFile(this.context) ? readFloatArgBits(this.context, floatRetSlot) : null;
            decodedRetValue = retTypeDecoder?.decode(floatRetBits ?? returnValue);
          } catch (e) {
            logger.error(`Decoder error during return value decoding of ${hookName}: ${e}`);
            return;
          }

          const instance = hook.methodType === "instance" ? (this.receiver as NativePointer).toString() : undefined;
          hookManager.frookyAgent.addEventToLog(new ObjcHookEvent(hook, instance, this.decodedArgs, decodedRetValue, this.stackTrace));
        },
      });
      countSuccessfulHooks++;
    }
    return countSuccessfulHooks;
  }

  /**
   * Resolves an `objcClass` declaration to one or more loaded Objective-C classes.
   *
   * A plain class name resolves to exactly one class. A wildcard pattern (`*` matching any characters, e.g. `NS*URL*`)
   * resolves to every currently loaded class matching it.
   */
  private async resolveObjcClass(objcClassName: string, timeoutSeconds: number): Promise<ObjC.Object[]> {
    logger.debug(`Resolving Objective-C class ${objcClassName} with a timeout of ${timeoutSeconds} seconds.`);

    if (objcClassName.includes("*")) {
      const pattern = wildcardPatternToRegExp(objcClassName);
      return this.pollUntilResolved(
        () => {
          const resolvedClasses = ObjcHookManager.getLoadedClassNames()
            .filter((className) => pattern.test(className))
            .map((className) => ObjC.classes[className]);
          return resolvedClasses.length > 0 ? resolvedClasses : null;
        },
        objcClassName,
        timeoutSeconds,
      );
    }

    return this.pollUntilResolved(
      () => {
        const resolvedClass = ObjC.classes[objcClassName];
        return resolvedClass ? [resolvedClass] : null;
      },
      objcClassName,
      timeoutSeconds,
    );
  }

  /**
   * Enumerating `ObjC.classes` is expensive (thousands of classes). Every wildcard `objcClass` pattern being resolved
   * would otherwise repeat it on every poll tick, although they all see the same list at that instant.
   * The result is cached for one poll tick and shared between all patterns, but still refreshes every tick
   * to pick up classes that load later.
   */
  private static getLoadedClassNames(): string[] {
    const now = Date.now();
    if (!this.loadedClassNamesCache || now >= this.loadedClassNamesCache.expiresAt) {
      this.loadedClassNamesCache = { names: Object.keys(ObjC.classes), expiresAt: now + HOOK_LOOKUP_INTERVAL_MS };
    }
    return this.loadedClassNamesCache.names;
  }

  private static loadedClassNamesCache: { names: string[]; expiresAt: number } | null = null;

  // resolves the method declaration (`-sel:`, `+sel:` or `sel:`) to the methods the class itself implements
  private resolveMethods(objcClass: ObjC.Object, inputHook: InputObjcHookNormalized): ObjcHook[] {
    const [, kind, selector] = /^\s*([+-])?\s*(.+?)\s*$/.exec(inputHook.method)!;
    const methodNames = objcClass.$ownMethods.filter((name) => name.slice(2) === selector && (!kind || name[0] === kind));
    if (methodNames.length === 0) {
      throw Error(`Skipping hook for ${inputHook.method}. This method is not implemented by class ${objcClass.$className}.`);
    }

    return methodNames.map((methodName) => {
      const method: ObjC.ObjectMethod = objcClass[methodName];
      const signature = parseObjcMethodEncoding(method.types);
      const decoderSettings = inputHook.decoderSettings ?? DEFAULT_DECODER_SETTINGS;
      const declaringClass = objcClass.$className;

      // declared params replace the types read from the method
      let params: Param[];
      if (inputHook.params) {
        if (inputHook.params.length !== signature.argTypes.length) {
          throw Error(
            `Skipping hook for ${methodName} of class ${declaringClass}. ` +
              `${inputHook.params.length} params declared, but the method takes ${signature.argTypes.length} (excluding self and _cmd).`,
          );
        }
        params = inputHook.params.map((inputParam) => ({ ...normalizeInputParam(inputParam), declaringClass }));
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
