import { HookSettings } from "./frookySettings";

// Why a hook call has no stack trace, see detectUnsafeContext()
export type UnsafeContext =
  // on an alternate signal stack (`sigaltstack`), typically 32KB, too small for a stack walk
  | "signal-stack"
  // inside dlopen()/dlclose() on this thread: the linker holds its lock and the module is only partly loaded
  | "in-linker"
  // little stack left on the thread
  | "low-stack"
  // before the app's code runs (spawn mode): only native frames are captured
  | "before-ready";

export interface HookStackTrace {
  platformStackTrace: string[];
  nativeStackTrace: string[];
  // set when requested frames were not captured, e.g. `before-ready` has native but no platform frames
  skipped?: UnsafeContext;
}

export const EMPTY_STACK_TRACE: HookStackTrace = Object.freeze({
  platformStackTrace: [],
  nativeStackTrace: [],
});

export interface PlatformStackTrace {
  // `unsafeContext` is the call's detectUnsafeContext() result. Throws FilterMismatchError if the
  // stackTraceFilter doesn't match the captured frames.
  build(settings: HookSettings, ctx?: CpuContext, unsafeContext?: UnsafeContext): HookStackTrace;
}

// per stackTraceFilter array, which lives as long as its hook
const filterCache = new WeakMap<string[], RegExp[]>();

// patterns are validated when the hook file is loaded
export function compileStackTraceFilter(stackTraceFilter: string[]): RegExp[] {
  let regExps = filterCache.get(stackTraceFilter);
  if (regExps === undefined) {
    regExps = stackTraceFilter.map((pattern) => new RegExp(pattern));
    filterCache.set(stackTraceFilter, regExps);
  }
  return regExps;
}

// Whether hooks with these settings build a stack trace on every call
export function needsStackTrace(settings: HookSettings): boolean {
  return settings.platformStackTrace || settings.nativeStackTrace || (settings.stackTraceFilter?.length ?? 0) > 0;
}
