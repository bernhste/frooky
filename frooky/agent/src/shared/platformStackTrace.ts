import { HookSettings } from "./frookySettings";

// Why a hook call's stack trace is incomplete or missing, see detectUnsafeContext()
export type UnsafeContext =
  // on an alternate signal stack (`sigaltstack`), typically 32KB: symbolizing or a Java walk can overflow it
  | "signal-stack"
  // another thread is inside dlopen()/dlclose(): it can hold the linker's lock while it waits for the JS lock in a hook
  // (e.g. in a library constructor), and the accurate backtracer needs the linker's lock (dl_iterate_phdr())
  | "linker-busy"
  // little stack left on the thread
  | "low-stack"
  // before the app's code runs (spawn mode): a native hook can fire on a thread that is still attaching to the VM
  | "before-ready";

export interface HookStackTrace {
  platformStackTrace: string[];
  nativeStackTrace: string[];
  // set when requested frames were not captured, e.g. a native hook has native but no platform frames at `before-ready`
  skipped?: UnsafeContext;
}

export const EMPTY_STACK_TRACE: HookStackTrace = Object.freeze({
  platformStackTrace: [],
  nativeStackTrace: [],
});

// What a hook asks PlatformStackTrace.build() for, besides its HookSettings
export interface StackTraceRequest {
  // an Interceptor callback's `this.context`, for the native frames; none for Java hooks
  ctx?: CpuContext;
  // the call's detectUnsafeContext() result
  unsafeContext?: UnsafeContext;
  // whether to match the callerFilter against the Java stack: Java hooks only, native hooks match the direct caller
  filterCallers: boolean;
}

export interface PlatformStackTrace {
  // Called once at targetReady, on the agent's thread
  prepare?(): void;
  // Throws FilterMismatchError if `filterCallers` is set and the callerFilter doesn't match.
  build(settings: HookSettings, request: StackTraceRequest): HookStackTrace;
}

// per filter array, which lives as long as its hook
const filterCache = new WeakMap<string[], RegExp[]>();

// patterns are validated when the hook file is loaded
export function compileCallerFilter(patterns: string[]): RegExp[] {
  let regExps = filterCache.get(patterns);
  if (regExps === undefined) {
    regExps = patterns.map((pattern) => new RegExp(pattern));
    filterCache.set(patterns, regExps);
  }
  return regExps;
}

// Whether hooks with these settings build a stack trace on every call
export function needsStackTrace(settings: HookSettings): boolean {
  return settings.platformStackTrace || settings.nativeStackTrace;
}
