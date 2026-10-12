import { Param } from "../../shared/decoders/decodable";
import z from "zod";

import { hasHookList, validateInput } from "../../shared/configValidator";
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
import { inputNativeHookCollectionSchema, inputNativeHookSchema } from "../../shared/inputParsing/zodSchemas/inputNativeHookCollection.zod";
import { logger } from "../../shared/logger";
import {
  validateDecoderArgRoles,
  validateDecoderOptions,
  validateDecoderNames,
  validateValueTypes,
} from "../../shared/inputParsing/inputDecodableTypes";
import { acceptedNativeDecoderArgs, acceptedNativeDecoderOptions, NATIVE_DECODER_NAMES } from "../decoders/nativeDecoderResolver";

const inputNativeHookCollectionHeaderSchema = inputNativeHookCollectionSchema.omit({ hooks: true });

export class NativeHookValidator implements HookValidator<NativeHookDeclaration, InputNativeHookCollection> {
  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): NativeHookDeclaration[] {
    const nativeHookCollections = this.getPlatformHookCollections(inputFrookyConfig);
    const normalizedNativeHooks: NativeHookDeclaration[] = [];

    for (const nativeHookCollection of nativeHookCollections) {
      let collectionSettings;
      try {
        const { hooks: _hooks, ...header } = nativeHookCollection;
        // before the schema, whose message for a name that doesn't match its pattern has no hint
        rejectModulePath(nativeHookCollection.module);
        validateInput(inputNativeHookCollectionHeaderSchema, header, "The hook collection");
        collectionSettings = mergeNativeHookCollectionSettings(nativeHookCollection, settings);
      } catch (e) {
        logger.warn(`Skipping the hook collection for module '${nativeHookCollection.module}': ${e instanceof Error ? e.message : e}`);
        continue;
      }
      const { hookSettings, decoderSettings } = collectionSettings;
      for (const inputNativeHook of nativeHookCollection.hooks) {
        const target = describeNativeFunction(inputNativeHook);
        try {
          const validInputHook = validateInput(inputNativeHookSchema, inputNativeHook, "The hook");
          const validatedHook = normalizeNativeHook(validInputHook, nativeHookCollection.module, hookSettings, decoderSettings);
          validateValueTypes([...(validatedHook.params ?? []), ...(validatedHook.returns ? [validatedHook.returns] : [])], "native");
          validateDecoderArgRoles(validatedHook.params, acceptedNativeDecoderArgs);
          const values: [string, DecoderSettings | undefined][] = [
            ...(validatedHook.params ?? []).map((p): [string, DecoderSettings] => [p.name ?? p.type, p.settings]),
            ["return value", validatedHook.returns?.settings],
          ];
          validateDecoderOptions(values, acceptedNativeDecoderOptions);
          validateDecoderNames(
            [validatedHook.decoderSettings, validatedHook.returns?.settings, ...(validatedHook.params ?? []).map((p) => p.settings)],
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
    for (const hookScope of inputFrookyConfig.hookCollections) {
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

// e.g. `libc.so` or `libc` for `libc.so`
function isModule(moduleName: string, library: string): boolean {
  const normalized = moduleName.toLowerCase();
  return normalized === library || normalized === library.replace(/\.so$/, "");
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
  if (settings.nativeStackTrace || settings.javaStackTrace) {
    logger.warn(`No stack traces for native function '${hook.symbol}' from module '${hook.module}': ${blocked.reason}.`);
    return { ...hook, hookSettings: { ...settings, nativeStackTrace: false, javaStackTrace: false } };
  }
  return hook;
}

export function warnOnHighFrequencyLibcHook(hook: NativeHookDeclaration): void {
  if (!hook.symbol || !isLibcModule(hook.module) || !HIGH_FREQUENCY_LIBC_SYMBOLS.has(hook.symbol)) {
    return;
  }

  if (hook.hookSettings.nativeStackTrace || hook.hookSettings.javaStackTrace) {
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
  if (!hook.hookSettings.early || !hook.hookSettings.javaStackTrace) return;
  logger.info(
    `${describeNativeTarget(hook.module, hook)} has early: true and javaStackTrace: its calls before targetReady get native frames, but no Java frames (skipped: before-ready), as walking the Java stack of a thread that is still attaching to the Java VM crashes the app.`,
  );
}

// The linker and Frida know a module by its file name; a path would never match the modules a pattern is compared with
function rejectModulePath(module: unknown): void {
  if (typeof module === "string" && module.includes("/")) {
    throw Error(`'module' must be the file name of the module, e.g. '${module.slice(module.lastIndexOf("/") + 1)}', not a path.`);
  }
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
      `decoder: errno on '${param.name ?? param.type}' is only supported on the return value, e.g. 'returns: [int, { decoder: errno }]'.`,
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
