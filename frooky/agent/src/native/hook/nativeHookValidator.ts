import { Param } from "../../shared/decoders/decodable";
import z from "zod";

import { hasHookList, validateInputHook } from "../../shared/configValidator";
import { InputFrookyConfig } from "../../shared/frookyConfig";
import { DecoderSettings, FrookySettings } from "../../shared/frookySettings";
import { NativeHookDeclaration } from "../../shared/hook/hookDeclaration";
import { HookValidator } from "../../shared/hook/hookValidator";
import {
  describeNativeTarget,
  InputNativeHookCollection,
  isNativeHookCollection,
  mergeNativeHookCollectionSettings,
  normalizeNativeHook,
} from "../../shared/inputParsing/inputNativeHookCollection";
import { inputNativeHookSchema } from "../../shared/inputParsing/zodSchemas/inputNativeHookCollection.zod";
import { logger } from "../../shared/logger";
import { validateDecoderArgRoles, validateDecoderConfig, validateDecoderNames } from "../../shared/inputParsing/inputDecodableTypes";
import { acceptedNativeDecoderArgs, acceptedNativeDecoderConfig, NATIVE_DECODER_NAMES } from "../decoders/nativeDecoderResolver";

export class NativeHookValidator implements HookValidator<NativeHookDeclaration, InputNativeHookCollection> {
  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): NativeHookDeclaration[] {
    const nativeHookCollections = this.getPlatformHookCollections(inputFrookyConfig);
    const normalizedNativeHooks: NativeHookDeclaration[] = [];

    for (const nativeHookCollection of nativeHookCollections) {
      const { hookSettings, decoderSettings } = mergeNativeHookCollectionSettings(nativeHookCollection, settings);
      for (const inputNativeHook of nativeHookCollection.hooks) {
        const target = describeNativeFunction(inputNativeHook);
        try {
          const validInputHook = validateInputHook(
            inputNativeHookSchema,
            inputNativeHook,
            `native ${target} from module '${nativeHookCollection.module}'`,
          );
          const validatedHook = normalizeNativeHook(validInputHook, nativeHookCollection.module, hookSettings, decoderSettings);
          validateDecoderArgRoles(validatedHook.params, acceptedNativeDecoderArgs);
          const values: [string, DecoderSettings | undefined][] = [
            ...(validatedHook.params ?? []).map((p): [string, DecoderSettings] => [p.name ?? p.type, p.settings]),
            ["return value", validatedHook.retType?.settings],
          ];
          validateDecoderConfig(values, acceptedNativeDecoderConfig);
          validateDecoderNames(
            [validatedHook.decoderSettings, validatedHook.retType?.settings, ...(validatedHook.params ?? []).map((p) => p.settings)],
            NATIVE_DECODER_NAMES,
            "native",
          );
          rejectErrnoOnParams(validatedHook.params);
          rejectOffsetInModulePattern(validatedHook);
          const allowedHook = applyBlockedFunctions(validatedHook);
          if (!allowedHook) continue;
          warnOnHighFrequencyLibcHook(allowedHook);
          noteEarlyPlatformStackTrace(allowedHook);
          normalizedNativeHooks.push(allowedHook);
        } catch (e) {
          const validationError = e instanceof z.ZodError ? z.prettifyError(e) : String(e instanceof Error ? e.message : e);
          logger.warn(
            `Skipping hook for native ${target} from module '${nativeHookCollection.module}' due to an invalid declaration:\n${validationError}`,
          );
        }
      }
    }
    logger.debug(`Normalized Native hook: ${JSON.stringify(normalizedNativeHooks, null, 2)}`);
    return normalizedNativeHooks;
  }

  getPlatformHookCollections(inputFrookyConfig: InputFrookyConfig): InputNativeHookCollection[] {
    const platformHookCollection: InputNativeHookCollection[] = [];
    for (const hookScope of inputFrookyConfig.hookCollection) {
      if (isNativeHookCollection(hookScope) && hasHookList(hookScope, `module '${hookScope.module}'`)) {
        platformHookCollection.push(hookScope);
      }
    }
    return platformHookCollection;
  }
}

export const HIGH_FREQUENCY_LIBC_SYMBOLS = new Set([
  "open",
  "openat",
  "close",
  "read",
  "write",
  "mmap",
  "mprotect",
  "malloc",
  "free",
  "memcpy",
  "memset",
]);

export function isLibcModule(moduleName: string): boolean {
  return isModule(moduleName, "libc.so");
}

// e.g. `libc.so`, `libc` or `/apex/com.android.runtime/lib64/bionic/libc.so` for `libc.so`
function isModule(moduleName: string, library: string): boolean {
  const normalized = moduleName.toLowerCase();
  return normalized === library || normalized === library.replace(/\.so$/, "") || normalized.endsWith(`/${library}`);
}

type BlockedFunction = {
  module: string;
  symbol: string;
  // completes "Skipping hook for native function 'x' from module 'y': "
  reason: string;
  // only blocked under this runtime
  runtime?: ScriptRuntime;
  // the hook is kept without stack traces
  stackTraceOnly?: boolean;
  // only for hooks with `early: true`, which run before targetReady
  earlyOnly?: boolean;
};

// Functions a hook breaks the app on, whatever the hook file says. Measured on Android 15 (x86_64) with a hook on
// each low-level function, with and without stack traces, under QuickJS and V8.
export const BLOCKED_FUNCTIONS: BlockedFunction[] = [
  { module: "libc.so", symbol: "pthread_getspecific", reason: "Frida's Interceptor uses it itself, so installing the hook hangs the app" },
  { module: "libc.so", symbol: "pthread_setspecific", reason: "Frida's Interceptor uses it itself, so installing the hook hangs the app" },
  {
    module: "libdl.so",
    symbol: "dlopen",
    reason:
      "the linker picks the namespace by the caller's address, which the hook changes, so loading system libraries (e.g. graphics drivers) fails",
  },
  { module: "libc.so", symbol: "memset", runtime: "V8", reason: "V8 calls it itself while it runs a hook, which re-enters V8 and crashes the app" },
  {
    module: "libc.so",
    symbol: "clock_gettime",
    runtime: "V8",
    reason: "V8 calls it itself while it runs a hook, which re-enters V8 and crashes the app",
  },
  { module: "libc.so", symbol: "sigprocmask", stackTraceOnly: true, reason: "the native stack walk crashes the app in it" },
  {
    module: "libc.so",
    symbol: "mmap",
    runtime: "V8",
    stackTraceOnly: true,
    earlyOnly: true,
    reason: "with early: true, a stack trace in it under V8 stops the app's start-up",
  },
];

export function findBlockedFunction(hook: NativeHookDeclaration): BlockedFunction | undefined {
  if (!hook.symbol) return undefined;
  return BLOCKED_FUNCTIONS.find(
    (blocked) =>
      blocked.symbol === hook.symbol &&
      isModule(hook.module, blocked.module) &&
      (!blocked.runtime || blocked.runtime === Script.runtime) &&
      (!blocked.earlyOnly || hook.hookSettings.early),
  );
}

// Null if BLOCKED_FUNCTIONS blocks the hook's function, else the hook, without stack traces if it blocks those
export function applyBlockedFunctions(hook: NativeHookDeclaration): NativeHookDeclaration | null {
  const blocked = findBlockedFunction(hook);
  if (!blocked) return hook;
  const { hookSettings: settings } = hook;
  if (!blocked.stackTraceOnly) {
    const hint = blocked.runtime ? " Use the default QuickJS runtime to hook it." : "";
    logger.warn(`Skipping hook for native function '${hook.symbol}' from module '${hook.module}': ${blocked.reason}.${hint}`);
    return null;
  }
  if (settings.nativeStackTrace || settings.platformStackTrace) {
    logger.warn(`No stack traces for native function '${hook.symbol}' from module '${hook.module}': ${blocked.reason}.`);
    return { ...hook, hookSettings: { ...settings, nativeStackTrace: false, platformStackTrace: false } };
  }
  return hook;
}

export function warnOnHighFrequencyLibcHook(hook: NativeHookDeclaration): void {
  if (!hook.symbol || !isLibcModule(hook.module) || !HIGH_FREQUENCY_LIBC_SYMBOLS.has(hook.symbol)) {
    return;
  }

  if (hook.hookSettings.nativeStackTrace || hook.hookSettings.platformStackTrace) {
    logger.warn(
      `Capturing stack traces on high-frequency libc function '${hook.symbol}' in '${hook.module}' can cause recursive stack unwinding or crashes. Keep stack traces disabled for low-level functions.`,
    );
  }

  if (hook.hookSettings.early && hook.hookSettings.callerFilter.length === 0) {
    logger.warn(
      `Early hooking enabled for high-frequency libc function '${hook.symbol}' in '${hook.module}' without a callerFilter. This can cause deadlocks or ANRs (Application Not Responding) during app bootstrap. Specify a callerFilter to restrict callers.`,
    );
  }
}

// A native hook's calls before targetReady get no Java frames, see AndroidStackTrace.build()
export function noteEarlyPlatformStackTrace(hook: NativeHookDeclaration): void {
  if (!hook.hookSettings.early || !hook.hookSettings.platformStackTrace) return;
  logger.info(
    `${describeNativeTarget(hook.module, hook)} has early: true and platformStackTrace: its calls before targetReady get native frames, but no Java frames (skipped: before-ready), as walking the Java stack of a thread that is still attaching to the Java VM crashes the app.`,
  );
}

// An offset only fits one build of one library, so it can't apply to every module a pattern matches
function rejectOffsetInModulePattern(hook: NativeHookDeclaration): void {
  if (hook.offset !== undefined && hook.module.includes("*")) {
    throw Error(`'offset' needs an exact module name, not the pattern '${hook.module}': an offset only fits one build of one library.`);
  }
}

// errno is only set by the call, so `decoder: errno` only applies to the return value
function rejectErrnoOnParams(params: Param[] | undefined): void {
  const param = params?.find((p) => p.settings.decoder === "errno");
  if (param) {
    throw new Error(
      `decoder: errno on '${param.name ?? param.type}' is only supported on the return value, e.g. 'retType: [int, { decoder: errno }]'.`,
    );
  }
}

// e.g. `function 'open'` or `function at offset '0x1a2b4'`, for a hook declaration that may not be valid yet
function describeNativeFunction(inputHook: unknown): string {
  if (typeof inputHook === "string") return `function '${inputHook}'`;
  if (Array.isArray(inputHook)) return `function '${inputHook[0]}'`;
  const { symbol, offset } = (inputHook ?? {}) as { symbol?: unknown; offset?: unknown };
  if (symbol !== undefined) return `function '${symbol}'`;
  return offset !== undefined ? `function at offset '${offset}'` : "function";
}
