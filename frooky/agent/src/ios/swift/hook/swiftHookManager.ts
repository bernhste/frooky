import Swift from "frida-swift-bridge";
import type { Class, Enum, RuntimeInstance, Struct } from "frida-swift-bridge/dist/lib/types.js";
import { FrookyAgent } from "../../../FrookyAgent";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { Param } from "../../../shared/decoders/decodable";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS, HOOK_LOOKUP_INTERVAL_MS } from "../../../shared/defaultValues";
import { DecodedArgs, HookManager } from "../../../shared/hook/hookManager";
import { normalizeInputParams, normalizeInputRetTypeSettings } from "../../../shared/inputParsing/inputDecodableTypes";
import { getSwiftOwner, InputSwiftHookNormalized } from "../../../shared/inputParsing/inputSwiftHookCollection";
import { logger } from "../../../shared/logger";
import { PlatformStackTrace } from "../../../shared/platformStackTrace";
import { FilterMismatchError, fromSource, plural, wildcardPatternToRegExp } from "../../../shared/utils";
import { SwiftDecoderResolver } from "../decoders/swiftDecoderResolver";
import { matchesSwiftMethodDeclaration, parseSwiftMethod } from "../swiftMethodSignature";
import { findValueTypeMethods, SwiftMethodDetails } from "../swiftValueTypeMethods";
import { SwiftHook } from "./swiftHook";
import { SwiftHookEvent } from "./swiftHookEvent";

type SwiftKind = "class" | "struct" | "enum";
type SwiftType = Class | Struct | Enum;
type SwiftInvocationContext = InvocationContext & Record<string, any>;

// the Swift calling convention passes `self` in this register on arm64
const SWIFT_SELF_REGISTER = "x20";

function ownerOf(inputHook: InputSwiftHookNormalized): { kind: SwiftKind; name: string } {
  const owner = getSwiftOwner(inputHook);
  if ("swiftClass" in owner) return { kind: "class", name: owner.swiftClass };
  if ("swiftStruct" in owner) return { kind: "struct", name: owner.swiftStruct };
  return { kind: "enum", name: owner.swiftEnum };
}

function qualifiedName(swiftType: SwiftType): string {
  return `${swiftType.$moduleName}.${swiftType.$name}`;
}

function registryOf(kind: SwiftKind): Record<string, SwiftType> {
  return kind === "class" ? Swift.classes : kind === "struct" ? Swift.structs : Swift.enums;
}

// Hooks Swift methods with Swift.Interceptor, which maps the raw arguments to Swift values using the types of
// the method's demangled symbol. Only methods with a symbol the bridge can parse can be hooked.
export class SwiftHookManager extends HookManager<InputSwiftHookNormalized, SwiftHook, RuntimeInstance> {
  // threads inside a hook callback, so methods called while decoding aren't captured
  private activeThreads = new Set<number>();

  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    super(SwiftDecoderResolver, platformStackTrace, frookyAgent);
  }

  async resolveHooks(inputHooks: InputSwiftHookNormalized[], timeout: number, source?: string): Promise<Promise<SwiftHook[] | null>[]> {
    const owners = inputHooks.map(ownerOf);
    logger.info(
      `Resolving ${plural(inputHooks.length, "Swift hook")} in ${plural(new Set(owners.map((o) => `${o.kind}:${o.name}`)).size, "type")}${fromSource(source)}`,
    );

    // each type is resolved once, no matter how many hooks target it
    const swiftTypePromises = new Map<string, Promise<SwiftType[]>>();
    return inputHooks.map(async (inputHook, i): Promise<SwiftHook[] | null> => {
      const { kind, name } = owners[i];
      const key = `${kind}:${name}`;
      let swiftTypesPromise = swiftTypePromises.get(key);
      if (!swiftTypesPromise) {
        swiftTypesPromise = this.resolveSwiftTypes(kind, name, timeout).catch((e) => {
          logger.warn(e instanceof Error ? e.message : String(e));
          return [] as SwiftType[];
        });
        swiftTypePromises.set(key, swiftTypesPromise);
      }
      const resolvedTypes = await swiftTypesPromise;
      if (resolvedTypes.length === 0) return null;

      const hooks: SwiftHook[] = [];
      for (const resolvedType of resolvedTypes) {
        try {
          hooks.push(...this.resolveMethods(resolvedType, kind, inputHook));
        } catch (e) {
          logger.warn(e instanceof Error ? e.message : String(e));
        }
      }
      return hooks.length > 0 ? hooks : null;
    });
  }

  registerHooks(hooks: SwiftHook[], source?: string): number {
    const hookManager = this;
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      const target = `${hook.swiftType}.${hook.methodName}`;

      // resolved once per hook, not per call
      const argDecoders = this.resolveParamDecoders(hook.params);
      const inArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "in" || argDecoder.direction === "inout");
      const outArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "out" || argDecoder.direction === "inout");
      const retTypeDecoder: Decoder<RuntimeInstance> | undefined = hook.retType ? this.resolveRetTypeDecoder(hook.retType) : undefined;
      const needsStackTrace = hook.hookSettings.maxStackFrames > 0 || hook.hookSettings.stackTraceFilter.length > 0;

      // creates the event, `retValue` is undefined for a method without a return value
      const finish = function (this: SwiftInvocationContext, retValue: RuntimeInstance | undefined) {
        const decodedArgs: DecodedArgs = { in: this.argsIn, out: [] };
        if (outArgDecoders.length > 0) {
          try {
            decodedArgs.out = hookManager.decodeArgs(this.args, outArgDecoders, target);
          } catch (e) {
            if (!(e instanceof FilterMismatchError)) {
              logger.error(`Decoder error during 'onLeave' argument decoding of ${target}: ${e}`);
            }
            return;
          }
        }

        let decodedRetValue: DecodedValue | undefined;
        if (retValue && retTypeDecoder) {
          try {
            decodedRetValue = hookManager.decodeValue(retTypeDecoder, retValue, `${target} return value`);
          } catch (e) {
            logger.error(`Decoder error during return value decoding of ${target}: ${e}`);
            return;
          }
        }

        hookManager.frookyAgent.addEventToLog(new SwiftHookEvent(hook, this.instance, decodedArgs, decodedRetValue, this.stackTrace));
      };

      // per-call state lives on `this` (Frida's invocation context): another thread or a recursive call can
      // enter the hook between onEnter and onLeave
      const onEnter = function (this: SwiftInvocationContext, args: RuntimeInstance[]) {
        const tid = Process.getCurrentThreadId();
        if (hookManager.activeThreads.has(tid)) {
          this.filtered = true;
          return;
        }
        hookManager.activeThreads.add(tid);
        try {
          this.filtered = false;
          this.args = args;
          // only methods of classes get `self` in that register, for structs and enums it is an ordinary argument or missing
          this.instance =
            hook.swiftKind === "class" ? String((this.context as unknown as Record<string, NativePointer>)[SWIFT_SELF_REGISTER]) : undefined;

          try {
            this.argsIn = inArgDecoders.length > 0 ? hookManager.decodeArgs(args, inArgDecoders, target) : [];
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

          // the bridge has no onLeave for methods without a return value, so their event is created right away
          if (!hook.retType) {
            finish.call(this, undefined);
          }
        } finally {
          hookManager.activeThreads.delete(tid);
        }
      };

      const onLeave = function (this: SwiftInvocationContext, retValue: RuntimeInstance) {
        if (this.filtered) return;
        const tid = Process.getCurrentThreadId();
        if (hookManager.activeThreads.has(tid)) return;
        hookManager.activeThreads.add(tid);
        try {
          finish.call(this, retValue);
        } finally {
          hookManager.activeThreads.delete(tid);
        }
      };

      try {
        hook.listener = Swift.Interceptor.attach(hook.address, { onEnter, onLeave: hook.retType ? onLeave : undefined });
      } catch (e) {
        logger.warn(`Failed to hook ${target} (${hook.methodSymbol}): ${e}`);
        continue;
      }
      logger.info(`Hooked ${hook.methodSymbol}${fromSource(source)}`);
      countSuccessfulHooks++;
    }
    return countSuccessfulHooks;
  }

  unregisterHooks(hooks: SwiftHook[]): void {
    for (const hook of hooks) {
      hook.listener?.detach();
      hook.listener = undefined;
    }
  }

  // Polls until the type is found. A plain name is looked up as `Module.Type` or `Type`, a wildcard pattern
  // (`*` matching any characters) is matched against the module qualified name, e.g. `MyApp.*ViewModel`.
  // The bridge reads the types of the loaded modules once, so types of modules loaded later are not found.
  private async resolveSwiftTypes(kind: SwiftKind, swiftTypeName: string, timeoutSeconds: number): Promise<SwiftType[]> {
    logger.debug(`Resolving Swift ${kind} ${swiftTypeName} with a timeout of ${timeoutSeconds} seconds.`);

    if (swiftTypeName.includes("*")) {
      const pattern = wildcardPatternToRegExp(swiftTypeName);
      return this.pollUntilResolved(
        () => {
          const resolvedTypes = SwiftHookManager.getLoadedTypes(kind).filter((swiftType) => pattern.test(qualifiedName(swiftType)));
          return resolvedTypes.length > 0 ? resolvedTypes : null;
        },
        `Swift ${kind} matching '${swiftTypeName}'`,
        timeoutSeconds,
      );
    }

    return this.pollUntilResolved(
      () => {
        const dot = swiftTypeName.indexOf(".");
        let resolvedType: SwiftType | undefined = registryOf(kind)[swiftTypeName];
        if (!resolvedType && dot > 0) {
          const module = Swift.modules[swiftTypeName.slice(0, dot)];
          const moduleRegistry: Record<string, SwiftType> | undefined =
            kind === "class" ? module?.classes : kind === "struct" ? module?.structs : module?.enums;
          resolvedType = moduleRegistry?.[swiftTypeName.slice(dot + 1)];
        }
        return resolvedType ? [resolvedType] : null;
      },
      `Swift ${kind} '${swiftTypeName}'`,
      timeoutSeconds,
    );
  }

  // Listing all types takes long, so all wildcard lookups of one poll interval share the result.
  private static getLoadedTypes(kind: SwiftKind): SwiftType[] {
    const now = Date.now();
    const cached = this.loadedTypesCache.get(kind);
    if (cached && now < cached.expiresAt) return cached.types;

    const types = Object.values(registryOf(kind));
    this.loadedTypesCache.set(kind, { types, expiresAt: now + HOOK_LOOKUP_INTERVAL_MS });
    return types;
  }

  private static loadedTypesCache = new Map<SwiftKind, { types: SwiftType[]; expiresAt: number }>();

  // the bridge lists the methods of classes, the ones of structs and enums are found by their symbols
  private listMethods(swiftType: SwiftType, kind: SwiftKind): SwiftMethodDetails[] {
    if (kind === "class") {
      return (swiftType as Class).$methods.filter((method) => method.type === "Method");
    }
    return findValueTypeMethods(swiftType as Struct | Enum);
  }

  // All overloads of the type that match the method declaration.
  private resolveMethods(swiftType: SwiftType, kind: SwiftKind, inputHook: InputSwiftHookNormalized): SwiftHook[] {
    const declaringClass = qualifiedName(swiftType);
    const hooks: SwiftHook[] = [];

    for (const method of this.listMethods(swiftType, kind)) {
      const signature = parseSwiftMethod(method.name);
      if (!signature || !matchesSwiftMethodDeclaration(signature, inputHook.method)) continue;

      const decoderSettings = inputHook.decoderSettings ?? DEFAULT_DECODER_SETTINGS;

      // declared params replace the types taken from the symbol
      let params: Param[];
      if (inputHook.params) {
        if (inputHook.params.length !== signature.argTypeNames.length) {
          logger.warn(
            `Skipping overload '${method.name}'. ${inputHook.params.length} params declared, but the method takes ${signature.argTypeNames.length} (without self).`,
          );
          continue;
        }
        params = normalizeInputParams(inputHook.params).map((param) => ({ ...param, declaringClass }));
      } else {
        params = signature.argTypeNames.map((type, i) => ({
          type,
          name: signature.argLabels[i] || undefined,
          direction: "in",
          declaringClass,
          settings: decoderSettings,
        }));
      }

      hooks.push({
        swiftType: declaringClass,
        swiftKind: kind,
        methodName: signature.methodName,
        methodSymbol: method.name,
        address: method.address,
        params,
        retType:
          signature.retTypeName === "void"
            ? undefined
            : {
                type: signature.retTypeName,
                declaringClass,
                settings: inputHook.retType ? normalizeInputRetTypeSettings(inputHook.retType, decoderSettings) : decoderSettings,
              },
        hookSettings: inputHook.hookSettings ?? DEFAULT_HOOK_SETTINGS,
        decoderSettings,
      });
    }

    if (hooks.length === 0) {
      throw Error(`Skipping hook for '${inputHook.method}'. No matching, hookable method is implemented by ${kind} '${declaringClass}'.`);
    }
    return hooks;
  }
}
