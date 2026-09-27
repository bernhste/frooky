export interface PlatformStackTrace {
  build(limit: number, stackTraceFilter?: string[], ctx?: CpuContext): string[];
}

// compiled once per stackTraceFilter array, which the hook settings keep for the lifetime of a hook
const filterCache = new WeakMap<string[], RegExp[]>();

/** The stackTraceFilter patterns as regular expressions (validated when the hook file is loaded). */
export function compileStackTraceFilter(stackTraceFilter: string[]): RegExp[] {
  let regExps = filterCache.get(stackTraceFilter);
  if (regExps === undefined) {
    regExps = stackTraceFilter.map((pattern) => new RegExp(pattern));
    filterCache.set(stackTraceFilter, regExps);
  }
  return regExps;
}
