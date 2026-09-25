import Java from "frida-java-bridge";
import { PlatformStackTrace } from "../shared/platformStackTrace";
import { FilterMismatchError } from "../shared/utils";

export const AndroidStackTrace: PlatformStackTrace = {
  build(limit: number, stackTraceFilter?: string[], ctx?: CpuContext): string[] {
    // avoid the (unfiltered) native backtrace and the full Java.perform()/Java.backtrace() round-trip
    // below when no frames were asked for - both are expensive and this runs on every intercepted call
    if (limit <= 0 && !stackTraceFilter?.length) return [];

    // get native frames
    let nativeFrames: string[] = [];
    if (ctx && !stackTraceFilter?.length) {
      try {
        nativeFrames = Thread.backtrace(ctx, Backtracer.FUZZY)
          .slice(0, limit)
          .map((addr) => {
            const sym = DebugSymbol.fromAddress(addr);
            return `${sym.name ?? addr} (${sym.moduleName}:${sym.address})`;
          });
      } catch (_) {}
    }

    if (!Java.available) {
      if (stackTraceFilter?.length) throw new FilterMismatchError();
      return nativeFrames;
    }

    const env = Java.vm.tryGetEnv();
    if (env === null) {
      if (stackTraceFilter?.length) throw new FilterMismatchError();
      return nativeFrames;
    }

    let javaFrames: string[] = [];

    Java.perform(() => {
      try {
        const javaStackTrace = Java.backtrace();
        javaFrames = javaStackTrace.frames
          .slice(0, limit)
          .map((frame) => `${frame.className}.${frame.methodName} (${frame.fileName}:${frame.lineNumber})`);
      } catch (_) {}
    });

    if (stackTraceFilter && stackTraceFilter.length > 0) {
      const matches = javaFrames.some((line) => stackTraceFilter.some((pattern) => new RegExp(pattern).test(line)));
      if (!matches) {
        throw new FilterMismatchError();
      }
      return javaFrames;
    }

    return [...nativeFrames, ...javaFrames];
  },
};
