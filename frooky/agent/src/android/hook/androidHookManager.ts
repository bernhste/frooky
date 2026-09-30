import Java from "frida-java-bridge";
import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../../shared/decoders/baseDecoder";
import { Param } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS, HOOK_LOOKUP_INTERVAL_MS } from "../../shared/defaultValues";
import { DecoderSettings } from "../../shared/frookySettings";
import { DecodedArgs, HookManager, ParamDecoder } from "../../shared/hook/hookManager";
import { normalizeInputParams } from "../../shared/inputParsing/inputDecodableTypes";
import { InputJavaHookNormalized } from "../../shared/inputParsing/inputJavaHookCollection";
import { logger } from "../../shared/logger";
import { HookStackTrace, PlatformStackTrace } from "../../shared/platformStackTrace";
import { FilterMismatchError, fromSource, plural, wildcardPatternToRegExp } from "../../shared/utils";
import { JavaDecoderResolver } from "../decoders/javaDecoderResolver";
import { JavaHook } from "./javaHook";
import { JavaHookEvent } from "./javaHookEvent";

export type FieldType = {
  fieldType: "static" | "instance";
  hashCode?: string;
};

// Resolves and installs hooks on Java methods.
export class AndroidHookManager extends HookManager<InputJavaHookNormalized, JavaHook, Java.Wrapper> {
  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    super(JavaDecoderResolver, platformStackTrace, frookyAgent);
  }
  // hooks claiming an overload, keyed by its ArtMethod handle. Several configs can hook the same overload: the
  // last claim is active, removing it restores the previous one. frida-java-bridge keeps the replacement on the
  // Method wrapper, so all installs and reverts of an overload go through the same wrapper.
  private readonly overloadClaims = new Map<
    string,
    { method: Java.Method; claims: { hook: JavaHook; implementation: Java.MethodImplementation }[] }
  >();

  async resolveHooks(inputHooks: InputJavaHookNormalized[], timeout: number, source?: string): Promise<Promise<JavaHook[] | null>[]> {
    logger.info(
      `Resolving ${plural(inputHooks.length, "Java hook")} in ${plural(new Set(inputHooks.map((h) => h.javaClass)).size, "class", "classes")}${fromSource(source)}`,
    );

    // each class is resolved once, no matter how many hooks target it
    const javaClassPromises = new Map<string, Promise<Java.Wrapper[]>>();
    return inputHooks.map(async (inputHook): Promise<JavaHook[] | null> => {
      let javaClassesPromise = javaClassPromises.get(inputHook.javaClass);
      if (javaClassesPromise) {
        logger.debug(`Class lookup cache hit: ${inputHook.javaClass} (for ${inputHook.javaClass}.${inputHook.method})`);
      } else {
        logger.debug(`Class lookup cache miss: ${inputHook.javaClass} (for ${inputHook.javaClass}.${inputHook.method})`);
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

  registerHooks(hooks: JavaHook[], source?: string): number {
    const hookManager = this;
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      const target = `${hook.method.holder.$className}.${hook.methodName}`;
      // resolved once per hook, not per call
      let inArgDecoders: ParamDecoder<Java.Wrapper>[] = [];
      let outArgDecoders: ParamDecoder<Java.Wrapper>[] = [];
      if (hook.params) {
        const argDecoders = this.resolveParamDecoders(hook.params);
        inArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "in" || argDecoder.direction === "inout");
        outArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "out" || argDecoder.direction === "inout");
      }
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
        // throws FilterMismatchError if the stackTraceFilter matches no frame
        let stackTrace: HookStackTrace;
        try {
          stackTrace = hookManager.stackTrace.build(hook.hookSettings);
        } catch (e) {
          if (e instanceof FilterMismatchError) {
            return hook.method.apply(this, args);
          }
          throw e;
        }

        const decodedArgs: DecodedArgs = { in: [], out: [] };
        if (inArgDecoders.length > 0) {
          try {
            decodedArgs.in = hookManager.decodeArgs(args, inArgDecoders, target);
          } catch (e) {
            if (!(e instanceof FilterMismatchError)) {
              logger.error(`Decoder error during 'onEnter' argument decoding of ${hook.method.holder.$className}.${hook.methodName}: ${e}`);
            }
            return hook.method.apply(this, args);
          }
        }

        let returnValue;
        try {
          returnValue = hook.method.apply(this, args);
        } catch (e) {
          logger.error(`Error during execution of hooked method: ${e}`);
          throw e; // the app handles its own exception
        }

        if (outArgDecoders.length > 0) {
          try {
            decodedArgs.out = hookManager.decodeArgs(args, outArgDecoders, target);
          } catch (e) {
            if (!(e instanceof FilterMismatchError)) {
              logger.error(`Decoder error during 'onLeave' argument decoding of ${hook.method.holder.$className}.${hook.methodName}: ${e}`);
            }
            return returnValue;
          }
        }

        let decodedRetValue: DecodedValue | undefined;
        try {
          if (retTypeDecoder) {
            decodedRetValue = hookManager.decodeValue(retTypeDecoder, returnValue, `${target} return value`);
          }
        } catch (e) {
          logger.error(`Decoder error during return value decoding of ${hook.method.holder.$className}.${hook.methodName}: ${e}`);
          return returnValue;
        }

        const fieldType = hookManager.buildFieldType(this as Java.Wrapper, hook.decoderSettings.hashCode);

        hookManager.frookyAgent.addEventToLog(new JavaHookEvent(hook, fieldType, decodedArgs, decodedRetValue, stackTrace));

        return returnValue;
      };

      const key = hook.method.handle.toString();
      const overload = this.overloadClaims.get(key) ?? { method: hook.method, claims: [] };
      try {
        overload.method.implementation = implementation;
      } catch (e) {
        logger.warn(`Failed to hook ${target}: ${e}`);
        continue;
      }
      overload.claims.push({ hook, implementation });
      this.overloadClaims.set(key, overload);
      logger.info(`Hooked ${target}(${hook.method.argumentTypes.map((t) => t.className ?? t.name).join(", ")})${fromSource(source)}`);

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

  // Polls until the class is loaded, or for a wildcard pattern (e.g. `org.owasp.*.HttpClient`, `*` matching
  // one package or class segment) until at least one loaded class matches. Throws on timeout.
  private async resolveJavaClass(javaClassName: string, timeoutSeconds: number): Promise<Java.Wrapper[]> {
    logger.debug(`Resolving java class ${javaClassName} with a timeout of ${timeoutSeconds} seconds.`);

    if (javaClassName.includes("*")) {
      const pattern = wildcardPatternToRegExp(javaClassName);
      return this.pollUntilResolved(
        () => {
          const resolvedClasses = this.resolveMatchingJavaClasses(pattern);
          if (resolvedClasses.length === 0) return null;
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
          const resolvedJavaClass = Java.use(javaClassName);
          logger.debug(`Java class '${javaClassName}' resolved.`);
          return [resolvedJavaClass];
        } catch (_) {
          return null;
        }
      },
      `Java class '${javaClassName}'`,
      timeoutSeconds,
    );
  }

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

  // Java.enumerateLoadedClassesSync() can take hundreds of ms, so all wildcard lookups of one poll interval
  // share its result.
  private static getLoadedClassNames(): string[] {
    const now = Date.now();
    if (!this.loadedClassNamesCache || now >= this.loadedClassNamesCache.expiresAt) {
      this.loadedClassNamesCache = { names: Java.enumerateLoadedClassesSync(), expiresAt: now + HOOK_LOOKUP_INTERVAL_MS };
      logger.debug(`Loaded class list cache miss: enumerated ${this.loadedClassNamesCache.names.length} loaded classes`);
    } else {
      logger.debug(`Loaded class list cache hit: ${this.loadedClassNamesCache.names.length} loaded classes`);
    }
    return this.loadedClassNamesCache.names;
  }

  private static loadedClassNamesCache: { names: string[]; expiresAt: number } | null = null;

  private resolveMethod(javaClass: Java.Wrapper, inputHook: InputJavaHookNormalized): Java.MethodDispatcher {
    const resolvedMethod = javaClass[inputHook.method];
    if (resolvedMethod) {
      return resolvedMethod;
    } else {
      throw Error(`Skipping hook for '${inputHook.method}'. This method does not exist in class '${javaClass.$className}'.`);
    }
  }

  private resolveOverloads(method: Java.MethodDispatcher, inputHook: InputJavaHookNormalized): JavaHook[] {
    const result: JavaHook[] = [];
    const declaringClass = method.holder.$className;
    if (inputHook.overloads?.length) {
      // only the declared overloads
      for (const overload of inputHook.overloads) {
        const normalizedParams: Param[] = normalizeInputParams(overload.params).map((param: Param) => ({ ...param, declaringClass }));
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
      // all overloads
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
    // only on request, hashCode() calls into Java
    const hashCode = !isStatic && computeHashCode ? (method.hashCode() >>> 0).toString(16) : undefined;
    return { fieldType, hashCode };
  }
}
