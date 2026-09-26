import Java from "frida-java-bridge";
import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../../shared/decoders/baseDecoder";
import { Param } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS, HOOK_LOOKUP_INTERVAL_MS } from "../../shared/defaultValues";
import { DecoderSettings } from "../../shared/frookySettings";
import { DecodedArgs, HookManager, ParamDecoder } from "../../shared/hook/hookManager";
import { InputParam, normalizeInputParam } from "../../shared/inputParsing/inputDecodableTypes";
import { InputJavaHookNormalized } from "../../shared/inputParsing/inputJavaHookCollection";
import { logger } from "../../shared/logger";
import { PlatformStackTrace } from "../../shared/platformStackTrace";
import { FilterMismatchError, wildcardPatternToRegExp } from "../../shared/utils";
import { JavaDecoderResolver } from "../decoders/javaDecoderResolver";
import { JavaHook } from "./javaHook";
import { JavaHookEvent } from "./javaHookEvent";

export type FieldType = {
  fieldType: "static" | "instance";
  hashCode?: string;
};

// resolve java classes, the method and their overloads
export class AndroidHookManager extends HookManager<InputJavaHookNormalized, JavaHook, Java.Wrapper> {
  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    super(JavaDecoderResolver, platformStackTrace, frookyAgent);
  }
  // every hook currently claiming an overload, keyed by its ArtMethod handle. Several configs may declare
  // the same overload: the most recently registered claim is active, and removing it falls back to the
  // previous claim instead of unhooking a method another config still wants.
  // frida-java-bridge keeps the installed replacement on the Method wrapper object (and snapshots the
  // ArtMethod on every install), so all installs and reverts of one overload go through the same wrapper.
  private readonly overloadClaims = new Map<
    string,
    { method: Java.Method; claims: { hook: JavaHook; implementation: Java.MethodImplementation }[] }
  >();

  async resolveHooks(inputHooks: InputJavaHookNormalized[], timeout: number): Promise<Promise<JavaHook[] | null>[]> {
    logger.debug(`Resolving Java hooks`);

    // each class is resolved once, no matter how many hooks target it
    const javaClassPromises = new Map<string, Promise<Java.Wrapper[]>>();
    return inputHooks.map(async (inputHook): Promise<JavaHook[] | null> => {
      let javaClassesPromise = javaClassPromises.get(inputHook.javaClass);
      if (!javaClassesPromise) {
        javaClassesPromise = this.resolveJavaClass(inputHook.javaClass, timeout).catch((e) => {
          logger.warn(e instanceof Error ? e.message : String(e));
          return [] as Java.Wrapper[];
        });
        javaClassPromises.set(inputHook.javaClass, javaClassesPromise);
      }
      const resolvedJavaClasses = await javaClassesPromise;
      if (resolvedJavaClasses.length === 0) return null;

      const hooks: JavaHook[] = [];
      for (const resolvedJavaClass of resolvedJavaClasses) {
        try {
          const method = this.resolveMethod(resolvedJavaClass, inputHook);
          hooks.push(...this.resolveOverloads(method, inputHook));
        } catch (e) {
          logger.warn(e instanceof Error ? e.message : String(e));
        }
      }
      return hooks.length > 0 ? hooks : null;
    });
  }

  registerHooks(hooks: JavaHook[]): number {
    const hookManager = this;
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      // resolve the decoders used for this hook and cache it locally
      let inArgDecoders: ParamDecoder<Java.Wrapper>[];
      let outArgDecoders: ParamDecoder<Java.Wrapper>[];
      if (hook.params) {
        const argDecoders = this.resolveParamDecoders(hook.params);
        inArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "in" || argDecoder.direction === "inout");
        outArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "out" || argDecoder.direction === "inout");
      }
      // resolve the return type
      let retTypeDecoder: Decoder<Java.Wrapper>;
      if (hook.method.returnType.className) {
        const retType = {
          type: hook.method.returnType.className,
          declaringClass: hook.method.holder.$className,
          settings: hook.retTypeSettings ?? hook.decoderSettings,
        };
        retTypeDecoder = this.resolveRetTypeDecoder(retType);
      }

      const implementation = function (this: Java.Wrapper, ...args: Java.Wrapper[]) {
        // collect the stack trace and filter
        let stackTrace: string[];
        try {
          stackTrace = hookManager.stackTrace.build(hook.hookSettings.stackTraceLimit, hook.hookSettings.stackTraceFilter);
        } catch (e) {
          if (e instanceof FilterMismatchError) {
            // call the original implementation and return immediately
            return hook.method.apply(this, args);
          }
          throw e; // // re-throw stack trace build error
        }

        // decode arguments onEnter
        const decodedArgs: DecodedArgs = { in: [], out: [] };
        if (hook.params) {
          try {
            decodedArgs.in = hookManager.decodeArgs(args, inArgDecoders);
          } catch (e) {
            if (!(e instanceof FilterMismatchError)) {
              logger.error(`Decoder error during 'onEnter' argument decoding of ${hook.method.holder.$className}.${hook.methodName}: ${e}`);
            }
            // call the original implementation and return immediately
            return hook.method.apply(this, args);
          }
        }

        // call the original implementation
        let returnValue;
        try {
          returnValue = hook.method.apply(this, args);
        } catch (e) {
          logger.error(`Error during execution of hooked method: ${e}`);
          throw e; // re-throw so the app behaves normally
        }

        // decode arguments onLeave
        if (hook.params) {
          try {
            decodedArgs.out = hookManager.decodeArgs(args, outArgDecoders);
          } catch (e) {
            if (!(e instanceof FilterMismatchError)) {
              logger.error(`Decoder error during 'onLeave' argument decoding of ${hook.method.holder.$className}.${hook.methodName}: ${e}`);
            }
            return returnValue;
          }
        }

        // decode the return value
        let decodedRetValue: DecodedValue | undefined;
        try {
          if (retTypeDecoder) {
            decodedRetValue = retTypeDecoder.decode(returnValue);
          }
        } catch (e) {
          logger.error(`Decoder error during return value decoding of ${hook.method.holder.$className}.${hook.methodName}: ${e}`);
          return returnValue;
        }

        // collect the field type
        const fieldType = hookManager.buildFieldType(this as Java.Wrapper, hook.decoderSettings.hashCode);

        // add the event to the event log
        hookManager.frookyAgent.addEventToLog(new JavaHookEvent(hook, fieldType, decodedArgs, decodedRetValue, stackTrace));

        return returnValue;
      };

      const key = hook.method.handle.toString();
      const overload = this.overloadClaims.get(key) ?? { method: hook.method, claims: [] };
      try {
        overload.method.implementation = implementation;
      } catch (e) {
        logger.warn(`Failed to hook ${hook.method.holder.$className}.${hook.methodName}: ${e}`);
        continue;
      }
      overload.claims.push({ hook, implementation });
      this.overloadClaims.set(key, overload);

      countSuccessfulHooks++;
    }
    return countSuccessfulHooks;
  }

  unregisterHooks(hooks: JavaHook[]): void {
    for (const hook of hooks) {
      const key = hook.method.handle.toString();
      const overload = this.overloadClaims.get(key);
      const index = overload ? overload.claims.findIndex((claim) => claim.hook === hook) : -1;
      if (!overload || index < 0) continue;

      const { claims } = overload;
      claims.splice(index, 1);
      // only the last claim is active, an older one can be dropped without touching the method
      if (index < claims.length) continue;

      const previous = claims[claims.length - 1];
      if (!previous) this.overloadClaims.delete(key);
      try {
        // null reverts the method to its original implementation
        overload.method.implementation = previous?.implementation ?? null;
      } catch (e) {
        logger.warn(`Failed to unhook ${hook.method.holder.$className}.${hook.methodName}: ${e}`);
      }
    }
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

  /**
   * Resolves a `javaClass` declaration to one or more loaded Java classes.
   *
   * A plain class name (e.g. `org.owasp.mastestapp.MainActivity`) resolves to exactly one class.
   * A wildcard pattern (e.g. `org.owasp.*.HttpClient`, `*` matching a single package/class segment)
   * resolves to every currently loaded class matching it, since the pattern may match more than one.
   *
   * @param javaClassName - The `javaClass` declaration, plain or wildcarded.
   * @param timeoutSeconds - How long to keep polling for a match before giving up.
   * @returns The resolved classes. Never empty; the poll keeps retrying until at least one match or the timeout elapses.
   */
  private async resolveJavaClass(javaClassName: string, timeoutSeconds: number): Promise<Java.Wrapper[]> {
    logger.debug(`Resolving java class ${javaClassName} with a timeout of ${timeoutSeconds} seconds.`);

    if (javaClassName.includes("*")) {
      const pattern = wildcardPatternToRegExp(javaClassName);
      return this.pollUntilResolved(
        () => {
          logger.debug(`Trying to resolve Java classes matching wildcard pattern '${javaClassName}'.`);
          const resolvedClasses = this.resolveMatchingJavaClasses(pattern);
          if (resolvedClasses.length === 0) {
            logger.debug(`No Java classes matching wildcard pattern '${javaClassName}' resolved yet.`);
            return null;
          }
          logger.debug(`${resolvedClasses.length} Java class(es) matching wildcard pattern '${javaClassName}' resolved.`);
          return resolvedClasses;
        },
        `Java class matching '${javaClassName}'`,
        timeoutSeconds,
      );
    }

    return this.pollUntilResolved(
      () => {
        try {
          logger.debug(`Trying to resolve Java class '${javaClassName}'.`);

          const resolvedJavaClass = Java.use(javaClassName);
          logger.debug(`Java class '${javaClassName}' resolved.`);
          return [resolvedJavaClass];
        } catch (_) {
          logger.debug(`Java class '${javaClassName}' not resolved yet.`);
          return null;
        }
      },
      `Java class '${javaClassName}'`,
      timeoutSeconds,
    );
  }

  // resolves every currently loaded class whose name matches the given wildcard pattern
  private resolveMatchingJavaClasses(pattern: RegExp): Java.Wrapper[] {
    const resolvedClasses: Java.Wrapper[] = [];
    for (const className of AndroidHookManager.getLoadedClassNames()) {
      if (!pattern.test(className)) continue;
      try {
        resolvedClasses.push(Java.use(className));
      } catch (e) {
        logger.debug(`Failed to resolve matched Java class '${className}': ${e}`);
      }
    }
    return resolvedClasses;
  }

  /**
   * `Java.enumerateLoadedClassesSync()` is an expensive native/JNI call - it can take hundreds of
   * milliseconds on an app with many loaded classes. Every wildcard `javaClass` pattern being
   * resolved would otherwise re-run it on every poll tick, even though they'd all see the exact
   * same class list at that instant. This caches the result across all patterns/instances for the
   * duration of one poll tick, so it's shared within a tick but still refreshes every tick to pick
   * up classes that load later (which is the entire point of polling for a wildcard match).
   */
  private static getLoadedClassNames(): string[] {
    const now = Date.now();
    if (!this.loadedClassNamesCache || now >= this.loadedClassNamesCache.expiresAt) {
      this.loadedClassNamesCache = { names: Java.enumerateLoadedClassesSync(), expiresAt: now + HOOK_LOOKUP_INTERVAL_MS };
    }
    return this.loadedClassNamesCache.names;
  }

  private static loadedClassNamesCache: { names: string[]; expiresAt: number } | null = null;

  private resolveMethod(javaClass: Java.Wrapper, inputHook: InputJavaHookNormalized): Java.MethodDispatcher {
    const resolvedMethod = javaClass[inputHook.method];
    if (resolvedMethod) {
      return resolvedMethod;
    } else {
      throw Error(`Skipping hook for ${inputHook.method}. This method does not exist in class ${javaClass.$className}.`);
    }
  }

  private resolveOverloads(method: Java.MethodDispatcher, inputHook: InputJavaHookNormalized): JavaHook[] {
    const result: JavaHook[] = [];
    const declaringClass = method.holder.$className;
    if (inputHook.overloads?.length) {
      // Only get declared overloaded methods
      for (const overload of inputHook.overloads) {
        const normalizedParams: Param[] = overload.params.map(
          (inputParam: InputParam) => ({ ...(normalizeInputParam(inputParam) as Param), declaringClass }) as Param,
        );
        // extract a list of java parameter types e.g. ["int", "java.lang.String", "double"] to be used to look up the overload
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
      // Get all overloaded methods
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

  private buildFieldType(method: Java.Wrapper, computeHashCode: boolean): FieldType {
    const isStatic =
      method === null || method === undefined || method.$handle === null || method.$handle === undefined || method.$className === undefined;

    const fieldType = isStatic ? "static" : "instance";
    // hashCode() is a Frida <-> Java bridge round-trip, so it's only computed when explicitly requested
    const hashCode = !isStatic && computeHashCode ? (method.hashCode() >>> 0).toString(16) : undefined;
    return { fieldType, hashCode };
  }
}
