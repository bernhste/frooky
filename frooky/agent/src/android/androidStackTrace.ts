import Java from "frida-java-bridge";
import { nativeStackFrames } from "../native/nativeStackTrace";
import { HookSettings } from "../shared/frookySettings";
import { compileCallerFilter, HookStackTrace, PlatformStackTrace, StackTraceRequest } from "../shared/platformStackTrace";
import { FilterMismatchError } from "../shared/utils";
import { resolveArtWalkStack } from "./javaBridgeWorkarounds";

function formatJavaFrame(frame: Java.Frame): string {
  return `${frame.className}.${frame.methodName} (${frame.fileName}:${frame.lineNumber})`;
}

// frida-java-bridge builds its backtrace module on the first Java.backtrace() without a lock, and gives up the JS lock
// while doing so. A second thread entering then builds another module, and the first one's code is freed while still
// in use, which crashes the app. Other threads skip the Java frames until the first call returned.
let javaBacktraceState: "uninitialized" | "initializing" | "ready" = "uninitialized";

export const AndroidStackTrace: PlatformStackTrace = {
  // Builds the backtrace module before any hook needs it: the first Java.backtrace() needs the linker's lock, later
  // ones don't, so Java frames can be captured at `linker-busy`
  prepare() {
    if (Java.available && javaBacktraceState === "uninitialized") walkJavaStack();
  },

  build(settings: HookSettings, request: StackTraceRequest): HookStackTrace {
    const { maxStackFrames: limit, nativeStackTrace, platformStackTrace, callerFilter } = settings;
    const { ctx, unsafeContext } = request;
    const filterCallers = request.filterCallers && callerFilter.length > 0;
    const wantsNativeFrames = nativeStackTrace && ctx !== undefined && limit > 0;
    const wantsJavaFrames = platformStackTrace && limit > 0;

    // nothing requested: skip the expensive native and Java backtraces
    if (!wantsNativeFrames && !wantsJavaFrames && !filterCallers) {
      return { platformStackTrace: [], nativeStackTrace: [] };
    }

    // too little stack for symbolizing or a Java walk
    if (unsafeContext === "signal-stack" || unsafeContext === "low-stack") {
      if (filterCallers) throw FilterMismatchError.INSTANCE;
      return { platformStackTrace: [], nativeStackTrace: [], skipped: unsafeContext };
    }

    const linkerBusy = unsafeContext === "linker-busy";
    // Before targetReady, a native hook can fire on a thread that is still attaching to the VM: tryGetEnv() already
    // returns its JNIEnv, but walking its Java stack crashes the app. A Java hook's thread runs Java code, so it's
    // attached. At `linker-busy`, only an initialized Java.backtrace() works without the linker's lock.
    const javaBlocked = (unsafeContext === "before-ready" && ctx !== undefined) || (linkerBusy && javaBacktraceState !== "ready");
    // on a thread without Java, no app frame can be on the Java stack
    const canWalkJava = !javaBlocked && Java.available && Java.vm.tryGetEnv() !== null;
    if (filterCallers && !canWalkJava) throw FilterMismatchError.INSTANCE;

    const javaStack = canWalkJava && (wantsJavaFrames || filterCallers) ? walkJavaStack() : [];
    if (filterCallers) {
      const regExps = compileCallerFilter(callerFilter);
      // the whole stack, as an app often calls the hooked method through libraries (e.g. app -> OkHttp -> Cipher),
      // without the hooked method itself on top
      const callers = javaStack.slice(1);
      if (!callers.some((frame) => regExps.some((regExp) => regExp.test(`${frame.className}.${frame.methodName}`)))) {
        throw FilterMismatchError.INSTANCE;
      }
    }

    const nativeFrames = wantsNativeFrames && ctx ? nativeStackFrames(ctx, limit, linkerBusy) : [];
    const javaFrames = wantsJavaFrames ? javaStack.slice(0, limit).map(formatJavaFrame) : [];
    const skipped = wantsJavaFrames && javaBlocked ? unsafeContext : undefined;
    return { platformStackTrace: javaFrames, nativeStackTrace: nativeFrames, ...(skipped && { skipped }) };
  },
};

// The current thread's Java frames, innermost first. Empty while another thread initializes Java.backtrace(). The
// thread must be attached to the VM (Java.vm.tryGetEnv()).
function walkJavaStack(): Java.Frame[] {
  // Java.backtrace() ignores its limit option and walks the whole stack
  let javaStack: Java.Frame[] = [];
  // not Java.perform(), which queues the callback until the app's class loader is set
  if (javaBacktraceState !== "initializing") {
    const isFirstCall = javaBacktraceState === "uninitialized";
    if (isFirstCall) javaBacktraceState = "initializing";
    try {
      if (isFirstCall) resolveArtWalkStack();
      Java.vm.perform(() => {
        javaStack = Java.backtrace().frames;
      });
      javaBacktraceState = "ready";
    } catch (_) {
      if (isFirstCall) javaBacktraceState = "uninitialized";
    }
  }
  return javaStack;
}
