import Java from "frida-java-bridge";
import { nativeStackFrames } from "../native/nativeStackTrace";
import { compileStackTraceFilter, PlatformStackTrace } from "../shared/platformStackTrace";
import { FilterMismatchError } from "../shared/utils";

function formatJavaFrame(frame: Java.Frame): string {
  return `${frame.className}.${frame.methodName} (${frame.fileName}:${frame.lineNumber})`;
}

export const AndroidStackTrace: PlatformStackTrace = {
  build(limit: number, stackTraceFilter?: string[], ctx?: CpuContext): string[] {
    // avoid the (unfiltered) native backtrace and the full Java.vm.perform()/Java.backtrace() round-trip
    // below when no frames were asked for - both are expensive and this runs on every intercepted call
    if (limit <= 0 && !stackTraceFilter?.length) return [];

    // get native frames
    const nativeFrames = ctx && !stackTraceFilter?.length ? nativeStackFrames(ctx, limit) : [];

    if (!Java.available) {
      if (stackTraceFilter?.length) throw new FilterMismatchError();
      return nativeFrames;
    }

    const env = Java.vm.tryGetEnv();
    if (env === null) {
      if (stackTraceFilter?.length) throw new FilterMismatchError();
      return nativeFrames;
    }

    // Java.backtrace() always walks the whole stack (its limit option is ignored), so only the frames
    // that are used get formatted
    let javaStack: Java.Frame[] = [];

    // not Java.perform(): before the app's class loader is set (a hook firing early in spawn mode) it
    // would queue the callback instead of running it. The thread is already attached (env above).
    Java.vm.perform(() => {
      try {
        javaStack = Java.backtrace().frames;
      } catch (_) {}
    });

    const javaFrames = limit > 0 ? javaStack.slice(0, limit).map(formatJavaFrame) : [];

    // with a limit, the filter only searches the captured frames, which lets it ignore app frames deep
    // down the stack (e.g. framework code running inside an app's onCreate). Without a limit (default
    // 0) it searches the whole stack - searching zero frames would drop every event
    if (stackTraceFilter && stackTraceFilter.length > 0) {
      const regExps = compileStackTraceFilter(stackTraceFilter);
      const matchesFilter = (line: string) => regExps.some((regExp) => regExp.test(line));
      const matches = limit > 0 ? javaFrames.some(matchesFilter) : javaStack.some((frame) => matchesFilter(formatJavaFrame(frame)));
      if (!matches) {
        throw new FilterMismatchError();
      }
      return javaFrames;
    }

    return [...nativeFrames, ...javaFrames];
  },
};
