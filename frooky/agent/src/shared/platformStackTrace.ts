export interface HookStackTrace {
  platformStackTrace: string[];
  nativeStackTrace: string[];
}

export const EMPTY_STACK_TRACE: HookStackTrace = Object.freeze({
  platformStackTrace: [],
  nativeStackTrace: [],
});

export interface PlatformStackTrace {
  build(limit: number, stackTraceFilter?: string[], ctx?: CpuContext): HookStackTrace;
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
