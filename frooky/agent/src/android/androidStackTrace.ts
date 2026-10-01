import Java from "frida-java-bridge";
import { nativeStackFrames } from "../native/nativeStackTrace";
import { HookSettings } from "../shared/frookySettings";
import { compileStackTraceFilter, HookStackTrace, PlatformStackTrace } from "../shared/platformStackTrace";
import { FilterMismatchError } from "../shared/utils";

function formatJavaFrame(frame: Java.Frame): string {
  return `${frame.className}.${frame.methodName} (${frame.fileName}:${frame.lineNumber})`;
}

// frida-java-bridge builds its backtrace module on the first Java.backtrace() without a lock, and gives up the JS lock
// while doing so. A second thread entering then builds another module, and the first one's code is freed while still
// in use, which crashes the app. Other threads skip the Java frames until the first call returned.
let javaBacktraceState: "uninitialized" | "initializing" | "ready" = "uninitialized";

let sigaltstackFn: NativeFunction<number, [NativePointer, NativePointer]> | null = null;
let sigaltstackResolved = false;
let ossBuffer: NativePointer | null = null;

// Whether the current thread runs on an alternate signal stack (`sigaltstack`). Signal stacks are
// typically 32KB, too small for `Java.vm.perform()` or `Java.backtrace()`.
export function isOnSignalStack(ctx?: CpuContext): boolean {
  if (!sigaltstackResolved) {
    sigaltstackResolved = true;
    try {
      const libc = Process.findModuleByName("libc.so");
      const exportPtr = libc?.findExportByName("sigaltstack");
      if (exportPtr) {
        sigaltstackFn = new NativeFunction(exportPtr, "int", ["pointer", "pointer"]);
        ossBuffer = Memory.alloc(32);
      }
    } catch (_) {
      sigaltstackFn = null;
    }
  }
  if (!sigaltstackFn || !ossBuffer) return false;
  try {
    if (sigaltstackFn(ptr(0), ossBuffer) === 0) {
      // ss_flags is at offset Process.pointerSize (8 on 64-bit, 4 on 32-bit)
      const flags = ossBuffer.add(Process.pointerSize).readInt();
      // SS_ONSTACK = 1
      if ((flags & 1) !== 0) return true;
      if (ctx?.sp) {
        const ssSp = ossBuffer.readPointer();
        const ssSize = ossBuffer.add(Process.pointerSize * 2).readPointer();
        if (!ssSp.isNull() && !ssSize.isNull()) {
          const sp = ctx.sp;
          if (sp.compare(ssSp) >= 0 && sp.compare(ssSp.add(ssSize)) < 0) {
            return true;
          }
        }
      }
    }
  } catch (_) {}
  return false;
}

export const AndroidStackTrace: PlatformStackTrace = {
  build(settings: HookSettings, ctx?: CpuContext): HookStackTrace {
    const { maxStackFrames: limit, stackTraceFilter, nativeStackTrace, platformStackTrace } = settings;

    // no frames requested: skip the expensive native and Java backtraces
    if ((!nativeStackTrace && !platformStackTrace) || limit <= 0) {
      if (stackTraceFilter?.length) throw FilterMismatchError.INSTANCE;
      return { platformStackTrace: [], nativeStackTrace: [] };
    }

    if (isOnSignalStack(ctx)) {
      if (stackTraceFilter?.length) throw FilterMismatchError.INSTANCE;
      return { platformStackTrace: [], nativeStackTrace: [] };
    }

    const nativeFrames = nativeStackTrace && ctx ? nativeStackFrames(ctx, limit) : [];

    if (!platformStackTrace || !Java.available) {
      if (stackTraceFilter?.length) {
        const regExps = compileStackTraceFilter(stackTraceFilter);
        const matchesFilter = (line: string) => regExps.some((regExp) => regExp.test(line));
        if (!nativeFrames.some(matchesFilter)) {
          throw new FilterMismatchError();
        }
      }
      return { platformStackTrace: [], nativeStackTrace: nativeFrames };
    }

    const env = Java.vm.tryGetEnv();
    if (env === null) {
      if (stackTraceFilter?.length) {
        const regExps = compileStackTraceFilter(stackTraceFilter);
        const matchesFilter = (line: string) => regExps.some((regExp) => regExp.test(line));
        if (!nativeFrames.some(matchesFilter)) {
          throw new FilterMismatchError();
        }
      }
      return { platformStackTrace: [], nativeStackTrace: nativeFrames };
    }

    // Java.backtrace() ignores its limit option and walks the whole stack, so only the used frames are formatted
    let javaStack: Java.Frame[] = [];

    // not Java.perform(), which queues the callback until the app's class loader is set (early hooks in
    // spawn mode). The thread is already attached (env above).
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
      const javaMatches = javaFrames.some(matchesFilter);
      const nativeMatches = nativeFrames.some(matchesFilter);
      if (!javaMatches && !nativeMatches) {
        throw new FilterMismatchError();
      }
      return { platformStackTrace: javaFrames, nativeStackTrace: nativeFrames };
    }

    return { platformStackTrace: javaFrames, nativeStackTrace: nativeFrames };
  },
};
