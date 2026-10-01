import Java from "frida-java-bridge";
import { nativeStackFrames } from "../native/nativeStackTrace";
import { HookSettings } from "../shared/frookySettings";
import { compileStackTraceFilter, HookStackTrace, PlatformStackTrace, UnsafeContext } from "../shared/platformStackTrace";
import { FilterMismatchError } from "../shared/utils";

function formatJavaFrame(frame: Java.Frame): string {
  return `${frame.className}.${frame.methodName} (${frame.fileName}:${frame.lineNumber})`;
}

// frida-java-bridge builds its backtrace module on the first Java.backtrace() without a lock, and gives up the JS lock
// while doing so. A second thread entering then builds another module, and the first one's code is freed while still
// in use, which crashes the app. Other threads skip the Java frames until the first call returned.
let javaBacktraceState: "uninitialized" | "initializing" | "ready" = "uninitialized";

export const AndroidStackTrace: PlatformStackTrace = {
  build(settings: HookSettings, ctx?: CpuContext, unsafeContext?: UnsafeContext): HookStackTrace {
    const { maxStackFrames: limit, stackTraceFilter, nativeStackTrace, platformStackTrace } = settings;

    // no frames requested: skip the expensive native and Java backtraces
    if ((!nativeStackTrace && !platformStackTrace) || limit <= 0) {
      if (stackTraceFilter?.length) throw FilterMismatchError.INSTANCE;
      return { platformStackTrace: [], nativeStackTrace: [] };
    }

    if (unsafeContext !== undefined && unsafeContext !== "before-ready") {
      if (stackTraceFilter?.length) throw FilterMismatchError.INSTANCE;
      return { platformStackTrace: [], nativeStackTrace: [], skipped: unsafeContext };
    }

    const nativeFrames = nativeStackTrace && ctx ? nativeStackFrames(ctx, limit) : [];

    if (!platformStackTrace || !Java.available || unsafeContext === "before-ready" || Java.vm.tryGetEnv() === null) {
      if (stackTraceFilter?.length) {
        const regExps = compileStackTraceFilter(stackTraceFilter);
        if (!nativeFrames.some((line) => regExps.some((regExp) => regExp.test(line)))) {
          throw new FilterMismatchError();
        }
      }
      const skipped = platformStackTrace && unsafeContext === "before-ready" ? unsafeContext : undefined;
      return { platformStackTrace: [], nativeStackTrace: nativeFrames, ...(skipped && { skipped }) };
    }

    // Java.backtrace() ignores its limit option and walks the whole stack, so only the used frames are formatted
    let javaStack: Java.Frame[] = [];

    // not Java.perform(), which queues the callback until the app's class loader is set. The thread is already
    // attached (tryGetEnv() above).
    if (javaBacktraceState !== "initializing") {
      const isFirstCall = javaBacktraceState === "uninitialized";
      if (isFirstCall) javaBacktraceState = "initializing";
      try {
        Java.vm.perform(() => {
          javaStack = Java.backtrace().frames;
        });
        javaBacktraceState = "ready";
      } catch (_) {
        if (isFirstCall) javaBacktraceState = "uninitialized";
      }
    }

    const javaFrames = javaStack.slice(0, limit).map(formatJavaFrame);

    // with a limit, the filter only searches the captured frames, so app frames deep down the stack (e.g.
    // framework code called from an app's onCreate) don't match.
    if (stackTraceFilter && stackTraceFilter.length > 0) {
      const regExps = compileStackTraceFilter(stackTraceFilter);
      const matchesFilter = (line: string) => regExps.some((regExp) => regExp.test(line));
      if (!javaFrames.some(matchesFilter) && !nativeFrames.some(matchesFilter)) {
        throw new FilterMismatchError();
      }
    }

    return { platformStackTrace: javaFrames, nativeStackTrace: nativeFrames };
  },
};
