import { acceptedJavaDecoderArgs, acceptedJavaDecoderConfig, javaDecoderNames } from "../decoders/javaDecoderResolver";
import z from "zod";
import { hasHookList, validateInputHook } from "../../shared/configValidator";
import { InputFrookyConfig } from "../../shared/frookyConfig";
import { DecoderSettings, FrookySettings } from "../../shared/frookySettings";
import { JavaHookDeclaration } from "../../shared/hook/hookDeclaration";
import { HookValidator } from "../../shared/hook/hookValidator";
import { validateDecoderArgRoles, validateDecoderConfig, validateDecoderNames } from "../../shared/inputParsing/inputDecodableTypes";
import {
  InputJavaHookCollection,
  isJavaHookScope,
  mergeJavaHookCollectionSettings,
  normalizeJavaHook,
} from "../../shared/inputParsing/inputJavaHookCollection";
import { inputJavaHookSchema } from "../../shared/inputParsing/zodSchemas/inputJavaHookCollection.zod";
import { logger } from "../../shared/logger";

export class AndroidHookValidator implements HookValidator<JavaHookDeclaration, InputJavaHookCollection> {
  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): JavaHookDeclaration[] {
    const javaHookCollections = this.getPlatformHookCollections(inputFrookyConfig);
    const normalizedJavaHooks: JavaHookDeclaration[] = [];

    for (const javaHookCollection of javaHookCollections) {
      const { hookSettings, decoderSettings } = mergeJavaHookCollectionSettings(javaHookCollection, settings);
      for (const inputJavaHook of javaHookCollection.hooks) {
        const method = describeJavaMethod(inputJavaHook);
        try {
          const validInputHook = validateInputHook(
            inputJavaHookSchema,
            inputJavaHook,
            `java method '${method}' from class '${javaHookCollection.javaClass}'`,
          );
          const normalizedJavaHook = normalizeJavaHook(
            javaHookCollection.javaClass,
            validInputHook,
            hookSettings,
            decoderSettings,
            javaHookCollection.classLoader,
          );
          const overloads = normalizedJavaHook.overloads ?? [];
          overloads.forEach((overload) => validateDecoderArgRoles(overload.params, acceptedJavaDecoderArgs));
          const values = overloads.flatMap((overload) => [
            ...overload.params.map((p): [string, DecoderSettings] => [p.name ?? p.type, p.settings]),
            ["return value", overload.retType] as [string, DecoderSettings | undefined],
          ]);
          validateDecoderConfig(values, acceptedJavaDecoderConfig);
          validateConstantsSource(values);
          validateDecoderNames(
            [normalizedJavaHook.decoderSettings, ...overloads.flatMap((overload) => [overload.retType, ...overload.params.map((p) => p.settings)])],
            javaDecoderNames(),
            "Java",
          );
          if (!removeBlockedMethods(normalizedJavaHook)) continue;
          if (normalizedJavaHook.hookSettings.early) {
            logger.warn(
              `Early hooking ('early: true') is not supported for Java method '${normalizedJavaHook.method}' from class '${javaHookCollection.javaClass}' because Java hooks require the Android runtime (ART) to be initialized.`,
            );
            normalizedJavaHook.hookSettings = { ...normalizedJavaHook.hookSettings, early: false };
          }
          normalizedJavaHooks.push(normalizedJavaHook);
        } catch (e) {
          const validationError = e instanceof z.ZodError ? z.prettifyError(e) : String(e instanceof Error ? e.message : e);
          logger.warn(
            `Skipping hook for java method '${method}' from class '${javaHookCollection.javaClass}' due to an invalid declaration:\n${validationError}`,
          );
        }
      }
    }
    logger.debug(`Normalized Java hook: ${JSON.stringify(normalizedJavaHooks, null, 2)}`);
    return normalizedJavaHooks;
  }

  getPlatformHookCollections(inputFrookyConfig: InputFrookyConfig): InputJavaHookCollection[] {
    const platformHookCollection: InputJavaHookCollection[] = [];
    for (const hookScope of inputFrookyConfig.hookCollection) {
      if (isJavaHookScope(hookScope) && hasHookList(hookScope, `class '${hookScope.javaClass}'`)) {
        platformHookCollection.push(hookScope);
      }
    }
    return platformHookCollection;
  }
}

type BlockedMethod = {
  javaClass: string;
  // `$init` for constructors
  method: string;
  // only the overload with these parameter types, e.g. `["java.lang.String"]`
  params?: string[];
  // completes "Skipping hook for java method 'x' from class 'y': "
  reason: string;
};

// A hooked method is called from Frida's replacement of it, whose class is the hooked method's own class. Methods that
// look up their caller on the stack get that class, a boot class, instead of the app's class.
const CALLER_LOADER_REASON = "it uses its caller's class loader, which the hook turns into the boot class loader, so it doesn't find the app's";

// Methods a hook breaks the app on, whatever the hook file says. Measured on Android 12 and 15 (x86_64) with a plain
// Frida hook that only calls the original method. All of them break the app on Android 12; on Android 15, String
// constructors never run the hook, and Reflection.getCallerClass() didn't break it.
export const BLOCKED_METHODS: BlockedMethod[] = [
  {
    javaClass: "java.lang.String",
    method: "$init",
    reason:
      "ART runs a String constructor as a java.lang.StringFactory method, so the hook never runs, and on Android 12 the app aborts as ART finds no StringFactory method for the hooked constructor. Hook the newStringFrom* methods of java.lang.StringFactory instead",
  },
  {
    javaClass: "java.lang.Object",
    method: "$init",
    reason: "every object allocation in the runtime calls Object.<init>, hooking it floods the event log and destabilizes ART",
  },
  { javaClass: "java.lang.Class", method: "forName", params: ["java.lang.String"], reason: `${CALLER_LOADER_REASON} classes` },
  { javaClass: "java.lang.System", method: "loadLibrary", reason: `${CALLER_LOADER_REASON} native libraries` },
  ...["AtomicIntegerFieldUpdater", "AtomicLongFieldUpdater", "AtomicReferenceFieldUpdater"].map((updater) => ({
    javaClass: `java.util.concurrent.atomic.${updater}`,
    method: "newUpdater",
    reason: "it checks its caller's access to the field, which the hook turns into the updater class, so it throws IllegalAccessException",
  })),
  ...[
    { javaClass: "dalvik.system.VMStack", method: "getStackClass2" },
    { javaClass: "sun.reflect.Reflection", method: "getCallerClass" },
  ].map((target) => ({
    ...target,
    reason: "the hook adds a frame, so it returns the wrong caller and e.g. Class.forName() doesn't find the app's classes",
  })),
];

// Without `paramTypes`, only an entry that blocks every overload matches
export function findBlockedMethod(javaClass: string, method: string, paramTypes?: string[]): BlockedMethod | undefined {
  return BLOCKED_METHODS.find(
    (blocked) =>
      blocked.javaClass === javaClass &&
      blocked.method === method &&
      (!blocked.params || (paramTypes !== undefined && blocked.params.join(",") === paramTypes.join(","))),
  );
}

export function warnBlockedMethod(javaClass: string, method: string, blocked: BlockedMethod, paramTypes?: string[]): void {
  const target = blocked.params && paramTypes ? `${method}(${paramTypes.join(", ")})` : method;
  logger.warn(`Skipping hook for java method '${target}' from class '${javaClass}': ${blocked.reason}.`);
}

// Drops the blocked overloads a hook declares, see BLOCKED_METHODS. False if nothing of the hook is left. Blocked
// overloads of a hook without `overloads` are skipped when they are resolved.
function removeBlockedMethods(hook: JavaHookDeclaration): boolean {
  const blocked = findBlockedMethod(hook.javaClass, hook.method);
  if (blocked) {
    warnBlockedMethod(hook.javaClass, hook.method, blocked);
    return false;
  }
  if (!hook.overloads?.length) return true;
  hook.overloads = hook.overloads.filter((overload) => {
    const paramTypes = overload.params.map((param) => param.type);
    const blockedOverload = findBlockedMethod(hook.javaClass, hook.method, paramTypes);
    if (blockedOverload) warnBlockedMethod(hook.javaClass, hook.method, blockedOverload, paramTypes);
    return !blockedOverload;
  });
  return hook.overloads.length > 0;
}

// The method name of a hook declaration that may not be valid yet, for messages.
function describeJavaMethod(inputHook: unknown): string {
  if (typeof inputHook === "string") return inputHook;
  if (Array.isArray(inputHook)) return String(inputHook[0]);
  return String((inputHook as { method?: unknown } | null)?.method);
}

// Throws if `config` names the constants twice: a map in `constants`, and a class or fields to read them from
function validateConstantsSource(values: [label: string, settings: DecoderSettings | undefined][]): void {
  for (const [label, settings] of values) {
    const config = settings?.config;
    if (config?.constants && (config.class !== undefined || config.fields !== undefined)) {
      throw new Error(`config of '${label}': 'constants' can't be combined with 'class' or 'fields'. Use either the map or the fields of a class.`);
    }
  }
}
