import Swift from "frida-swift-bridge";
import type { Class, Enum, RuntimeInstance, Struct } from "frida-swift-bridge/dist/lib/types.js";
import { FrookyAgent } from "../../../FrookyAgent";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { Param } from "../../../shared/decoders/decodable";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS, HOOK_LOOKUP_INTERVAL_MS } from "../../../shared/defaultValues";
import { DecodedArgs, HookManager, ParamDecoder } from "../../../shared/hook/hookManager";
import { normalizeInputParam, normalizeInputRetTypeSettings } from "../../../shared/inputParsing/inputDecodableTypes";
import { getSwiftOwner, InputSwiftHookNormalized } from "../../../shared/inputParsing/inputSwiftHookCollection";
import { logger } from "../../../shared/logger";
import { PlatformStackTrace } from "../../../shared/platformStackTrace";
import { FilterMismatchError, wildcardPatternToRegExp } from "../../../shared/utils";
import { SwiftDecoderResolver } from "../decoders/swiftDecoderResolver";
import { matchesSwiftMethodDeclaration, parseSwiftMethod } from "../swiftMethodSignature";
import { findValueTypeMethods, SwiftMethodDetails } from "../swiftValueTypeMethods";
import { SwiftHook } from "./swiftHook";
import { SwiftHookEvent } from "./swiftHookEvent";

type SwiftKind = "class" | "struct" | "enum";
type SwiftType = Class | Struct | Enum;

// `self` is passed in this register by the Swift calling convention on arm64
const SWIFT_SELF_REGISTER = "x20";

/**
 * Resolves Swift classes and methods and hooks them using `Swift.Interceptor`, which maps the raw arguments
 * to Swift values using the types of the method's demangled symbol.
 *
 * Only methods the bridge enumerates (`$methods` of a class) can be hooked, and only those with a symbol the bridge can parse.
 */
export class SwiftHookManager extends HookManager<InputSwiftHookNormalized, SwiftHook, RuntimeInstance> {
  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    super(SwiftDecoderResolver, platformStackTrace, frookyAgent);
  }

  async resolveHooks(inputHooks: InputSwiftHookNormalized[], timeout: number): Promise<Promise<SwiftHook[] | null>[]> {
    logger.debug(`Resolving Swift hooks`);

    const uniqueTypes = new Map<string, { kind: SwiftKind; name: string }>();
    for (const inputHook of inputHooks) {
      const type = SwiftHookManager.ownerOf(inputHook);
      uniqueTypes.set(`${type.kind}:${type.name}`, type);
    }

    return [...uniqueTypes.entries()].flatMap(([key, { kind, name }]) => {
      const swiftTypesPromise = this.resolveSwiftTypes(kind, name, timeout).catch((e) => {
        logger.warn(`${e}`);
        return [] as SwiftType[];
      });
      return inputHooks
        .filter((inputHook) => {
          const owner = SwiftHookManager.ownerOf(inputHook);
          return `${owner.kind}:${owner.name}` === key;
        })
        .map(async (inputHook): Promise<SwiftHook[] | null> => {
          const resolvedTypes = await swiftTypesPromise;
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
    });
  }

  private static ownerOf(inputHook: InputSwiftHookNormalized): { kind: SwiftKind; name: string } {
    const owner = getSwiftOwner(inputHook);
    if ("swiftClass" in owner) return { kind: "class", name: owner.swiftClass };
    if ("swiftStruct" in owner) return { kind: "struct", name: owner.swiftStruct };
    return { kind: "enum", name: owner.swiftEnum };
  }

  registerHooks(hooks: SwiftHook[]): number {
    const hookManager = this;
    let countSuccessfulHooks = 0;

    for (const hook of hooks) {
      // resolve the decoders used for this hook and cache them locally
      const argDecoders = this.resolveParamDecoders(hook.params);
      const inArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "in" || argDecoder.direction === "inout");
      const outArgDecoders = argDecoders.filter((argDecoder) => argDecoder.direction === "out" || argDecoder.direction === "inout");
      const retTypeDecoder: Decoder<RuntimeInstance> | undefined = hook.retType ? this.resolveRetTypeDecoder(hook.retType) : undefined;
      const hookName = `${hook.swiftType}.${hook.methodName}`;

      // state is kept per invocation on `this`, as the same method can run on multiple threads at once
      const onEnter = function (this: InvocationContext & Record<string, any>, args: RuntimeInstance[]) {
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

        this.args = args;
        // only classes are called with `self` in that register, for structs and enums it is an ordinary argument or not present
        this.instance =
          hook.swiftKind === "class" ? String((this.context as unknown as Record<string, NativePointer>)[SWIFT_SELF_REGISTER]) : undefined;
        this.decodedArgs = { in: [], out: [] } as DecodedArgs;

        try {
          this.decodedArgs.in = hookManager.decodeArgs(args, inArgDecoders);
        } catch (e) {
          if (!(e instanceof FilterMismatchError)) {
            logger.error(`Decoder error during 'onEnter' argument decoding of ${hookName}: ${e}`);
          }
          this.filtered = true;
          return;
        }

        // the bridge does not support an onLeave callback for methods returning nothing, so the event is created right away
        if (!hook.retType) {
          finish.call(this, undefined);
        }
      };

      const finish = function (this: InvocationContext & Record<string, any>, retValue: RuntimeInstance | undefined) {
        try {
          this.decodedArgs.out = hookManager.decodeArgs(this.args, outArgDecoders);
        } catch (e) {
          if (!(e instanceof FilterMismatchError)) {
            logger.error(`Decoder error during 'onLeave' argument decoding of ${hookName}: ${e}`);
          }
          return;
        }

        let decodedRetValue: DecodedValue | undefined;
        try {
          decodedRetValue = retValue && retTypeDecoder ? retTypeDecoder.decode(retValue) : undefined;
        } catch (e) {
          logger.error(`Decoder error during return value decoding of ${hookName}: ${e}`);
          return;
        }

        hookManager.frookyAgent.addEventToLog(new SwiftHookEvent(hook, this.instance, this.decodedArgs, decodedRetValue, this.stackTrace));
      };

      try {
        Swift.Interceptor.attach(hook.address, {
          onEnter,
          onLeave: hook.retType
            ? function (this: InvocationContext & Record<string, any>, retValue: RuntimeInstance) {
                if (!this.filtered) finish.call(this, retValue);
              }
            : undefined,
        });
        countSuccessfulHooks++;
      } catch (e) {
        logger.warn(`Skipping hook for Swift method '${hook.methodSymbol}'. The bridge could not attach to it: ${e}`);
      }
    }
    return countSuccessfulHooks;
  }

  /**
   * Resolves a `swiftClass`, `swiftStruct` or `swiftEnum` declaration to one or more Swift types.
   *
   * A plain name is looked up as `Module.Type` or as `Type`. A wildcard pattern (`*` matching any characters)
   * is matched against the module qualified name, e.g. `MyApp.*ViewModel`, and resolves to every match.
   *
   * Note that the bridge reads all types of the loaded modules once, so types of modules loaded later are not found.
   */
  private async resolveSwiftTypes(kind: SwiftKind, swiftTypeName: string, timeoutSeconds: number): Promise<SwiftType[]> {
    logger.debug(`Resolving Swift ${kind} ${swiftTypeName} with a timeout of ${timeoutSeconds} seconds.`);

    if (swiftTypeName.includes("*")) {
      const pattern = wildcardPatternToRegExp(swiftTypeName);
      return this.pollUntilResolved(
        () => {
          const resolvedTypes = SwiftHookManager.getLoadedTypes(kind).filter((swiftType) => pattern.test(SwiftHookManager.qualifiedName(swiftType)));
          return resolvedTypes.length > 0 ? resolvedTypes : null;
        },
        swiftTypeName,
        timeoutSeconds,
      );
    }

    return this.pollUntilResolved(
      () => {
        const registry: Record<string, SwiftType> = kind === "class" ? Swift.classes : kind === "struct" ? Swift.structs : Swift.enums;
        const dot = swiftTypeName.indexOf(".");
        let resolvedType: SwiftType | undefined = registry[swiftTypeName];
        if (!resolvedType && dot > 0) {
          const module = Swift.modules[swiftTypeName.slice(0, dot)];
          const moduleRegistry: Record<string, SwiftType> | undefined =
            kind === "class" ? module?.classes : kind === "struct" ? module?.structs : module?.enums;
          resolvedType = moduleRegistry?.[swiftTypeName.slice(dot + 1)];
        }
        return resolvedType ? [resolvedType] : null;
      },
      swiftTypeName,
      timeoutSeconds,
    );
  }

  private static qualifiedName(swiftType: SwiftType): string {
    return `${swiftType.$moduleName}.${swiftType.$name}`;
  }

  /**
   * Same reasoning as the loaded class cache of the Android and Objective-C hook manager: all wildcard patterns
   * see the same list of types at that instant, so it is collected once per poll tick.
   */
  private static getLoadedTypes(kind: SwiftKind): SwiftType[] {
    const now = Date.now();
    const cached = this.loadedTypesCache.get(kind);
    if (cached && now < cached.expiresAt) return cached.types;

    const registry: Record<string, SwiftType> = kind === "class" ? Swift.classes : kind === "struct" ? Swift.structs : Swift.enums;
    const types = Object.values(registry);
    this.loadedTypesCache.set(kind, { types, expiresAt: now + HOOK_LOOKUP_INTERVAL_MS });
    return types;
  }

  private static loadedTypesCache = new Map<SwiftKind, { types: SwiftType[]; expiresAt: number }>();

  // the bridge lists the methods of classes, the ones of structs and enums are found by their symbol
  private listMethods(swiftType: SwiftType, kind: SwiftKind): SwiftMethodDetails[] {
    if (kind === "class") {
      return (swiftType as Class).$methods.filter((method) => method.type === "Method");
    }
    return findValueTypeMethods(swiftType as Struct | Enum);
  }

  // resolves the method declaration to all matching overloads the type implements
  private resolveMethods(swiftType: SwiftType, kind: SwiftKind, inputHook: InputSwiftHookNormalized): SwiftHook[] {
    const qualifiedClass = SwiftHookManager.qualifiedName(swiftType);
    const hooks: SwiftHook[] = [];

    for (const method of this.listMethods(swiftType, kind)) {
      const signature = parseSwiftMethod(method.name);
      if (!signature || !matchesSwiftMethodDeclaration(signature, inputHook.method)) continue;

      const decoderSettings = inputHook.decoderSettings ?? DEFAULT_DECODER_SETTINGS;

      // declared params replace the types read from the symbol
      let params: Param[];
      if (inputHook.params) {
        if (inputHook.params.length !== signature.argTypeNames.length) {
          logger.warn(
            `Skipping overload ${method.name}. ${inputHook.params.length} params declared, but the method takes ${signature.argTypeNames.length} (excluding self).`,
          );
          continue;
        }
        params = inputHook.params.map((inputParam) => ({ ...normalizeInputParam(inputParam), declaringClass: qualifiedClass }));
      } else {
        params = signature.argTypeNames.map((type, i) => ({
          type,
          name: signature.argLabels[i] || undefined,
          direction: "in",
          declaringClass: qualifiedClass,
          settings: decoderSettings,
        }));
      }

      hooks.push({
        swiftType: qualifiedClass,
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
                declaringClass: qualifiedClass,
                settings: inputHook.retType ? normalizeInputRetTypeSettings(inputHook.retType, decoderSettings) : decoderSettings,
              },
        hookSettings: inputHook.hookSettings ?? DEFAULT_HOOK_SETTINGS,
        decoderSettings,
      });
    }

    if (hooks.length === 0) {
      throw Error(`Skipping hook for ${inputHook.method}. No matching, hookable method is implemented by ${kind} ${qualifiedClass}.`);
    }
    return hooks;
  }
}
