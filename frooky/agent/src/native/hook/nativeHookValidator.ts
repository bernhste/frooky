import { Param, RetType } from "../../shared/decoders/decodable";
import z from "zod";

import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { HookValidator } from "../../shared/hook/hookValidator";
import {
  InputNativeHookCollection,
  InputNativeHookNormalized,
  isNativeHookCollection,
  mergeNativeHookCollectionSettings,
  normalizeNativeHook,
} from "../../shared/inputParsing/inputNativeHookCollection";
import { inputNativeHookNormalizedSchema } from "../../shared/inputParsing/zodSchemas/inputNativeHookCollection.zod";
import { logger } from "../../shared/logger";
import { validateDecoderArgRoles, validateDecoderNames } from "../../shared/inputParsing/inputDecodableTypes";
import { acceptedNativeDecoderArgs, NATIVE_DECODER_NAMES } from "../decoders/nativeDecoderResolver";

export class NativeHookValidator implements HookValidator<InputNativeHookNormalized, InputNativeHookCollection> {
  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): InputNativeHookNormalized[] {
    const nativeHookCollections = this.getPlatformHookCollections(inputFrookyConfig);
    const normalizedNativeHooks: InputNativeHookNormalized[] = [];

    for (const nativeHookCollection of nativeHookCollections) {
      const { hookSettings, decoderSettings } = mergeNativeHookCollectionSettings(nativeHookCollection, settings);
      for (const inputNativeHook of nativeHookCollection.hooks) {
        try {
          const normalizedNativeHook = normalizeNativeHook(inputNativeHook, nativeHookCollection.module, hookSettings, decoderSettings);
          validateDecoderArgRoles(normalizedNativeHook.params as Param[] | undefined, acceptedNativeDecoderArgs);
          validateDecoderNames(
            [
              normalizedNativeHook.decoderSettings,
              (normalizedNativeHook.retType as RetType | undefined)?.settings,
              ...((normalizedNativeHook.params as Param[] | undefined) ?? []).map((p) => p.settings),
            ],
            NATIVE_DECODER_NAMES,
            "native",
          );
          rejectErrnoOnParams(normalizedNativeHook.params as Param[] | undefined);
          let validatedHook = inputNativeHookNormalizedSchema.parse(normalizedNativeHook);
          const blocked = findBlockedFunction(validatedHook);
          if (blocked) {
            const { hookSettings: settings } = validatedHook;
            const hint = blocked.runtime ? " Use the default QuickJS runtime to hook it." : "";
            if (!blocked.stackTraceOnly) {
              logger.warn(
                `Skipping hook for native function '${validatedHook.symbol}' from module '${nativeHookCollection.module}': ${blocked.reason}.${hint}`,
              );
              continue;
            }
            if (settings && (settings.nativeStackTrace || settings.platformStackTrace)) {
              logger.warn(
                `No stack traces for native function '${validatedHook.symbol}' from module '${nativeHookCollection.module}': ${blocked.reason}.`,
              );
              validatedHook = { ...validatedHook, hookSettings: { ...settings, nativeStackTrace: false, platformStackTrace: false } };
            }
          }
          warnOnHighFrequencyLibcHook(validatedHook);
          normalizedNativeHooks.push(validatedHook);
        } catch (e) {
          const symbol =
            typeof inputNativeHook === "string" ? inputNativeHook : Array.isArray(inputNativeHook) ? inputNativeHook[0] : inputNativeHook.symbol;
          const offset = typeof inputNativeHook === "object" && !Array.isArray(inputNativeHook) ? inputNativeHook.offset : undefined;
          const target = symbol !== undefined ? `function '${symbol}'` : offset !== undefined ? `function at offset '${offset}'` : "function";
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
      if (isNativeHookCollection(hookScope)) {
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
];

export function findBlockedFunction(hook: InputNativeHookNormalized): BlockedFunction | undefined {
  if (!hook.symbol) return undefined;
  return BLOCKED_FUNCTIONS.find(
    (blocked) => blocked.symbol === hook.symbol && isModule(hook.module, blocked.module) && (!blocked.runtime || blocked.runtime === Script.runtime),
  );
}

export function warnOnHighFrequencyLibcHook(hook: InputNativeHookNormalized): void {
  if (!hook.symbol || !isLibcModule(hook.module) || !HIGH_FREQUENCY_LIBC_SYMBOLS.has(hook.symbol)) {
    return;
  }

  if (hook.hookSettings?.nativeStackTrace || hook.hookSettings?.platformStackTrace) {
    logger.warn(
      `Capturing stack traces on high-frequency libc function '${hook.symbol}' in '${hook.module}' can cause recursive stack unwinding or crashes. Keep stack traces disabled for low-level functions.`,
    );
  }

  if (hook.hookSettings?.early && (!hook.hookSettings.callerFilter || hook.hookSettings.callerFilter.length === 0)) {
    logger.warn(
      `Early hooking enabled for high-frequency libc function '${hook.symbol}' in '${hook.module}' without a callerFilter. This can cause deadlocks or ANRs (Application Not Responding) during app bootstrap. Specify a callerFilter to restrict callers.`,
    );
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
