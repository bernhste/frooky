import Java from "frida-java-bridge";
import { PlatformStackTrace } from "../shared/platformStackTrace";
import { FilterMismatchError } from "../shared/utils";

export const AndroidStackTrace: PlatformStackTrace = {
  build(limit: number, stackTraceFilter?: string[], ctx?: CpuContext): string[] {
    // get native frames
    let nativeFrames: string[] = [];
    if (ctx) {
      try {
        nativeFrames = Thread.backtrace(ctx, Backtracer.ACCURATE)
          .slice(0, limit)
          .map((addr) => {
            const sym = DebugSymbol.fromAddress(addr);
            return `${sym.name ?? addr} (${sym.moduleName}:${sym.address})`;
          });
      } catch (_) {}
    }

    if (!Java.available) return nativeFrames;

    let javaFrames: string[] = [];

    // try to get VM
    const env = Java.vm.tryGetEnv();
    if (env === null) {
      // pure native/platform thread, no Java above us
      return nativeFrames;
    }

    Java.perform(() => {
      const javaStackTrace = Java.backtrace({ limit });
      javaFrames = javaStackTrace.frames
        .slice(0, limit)
        .map((frame) => `${frame.className}.${frame.methodName} (${frame.fileName}:${frame.lineNumber})`);
    });

    // filter AFTER Java.perform, in the outer synchronous context
    if (stackTraceFilter && stackTraceFilter.length > 0) {
      const matches = javaFrames.some((line) => stackTraceFilter.some((pattern) => new RegExp(pattern).test(line)));
      if (!matches) {
        throw new FilterMismatchError();
      }
    }

    return [...nativeFrames, ...javaFrames];
  },
};
