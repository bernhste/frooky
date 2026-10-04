import Java from "frida-java-bridge";
import { sleepMilliseconds } from "../../shared/utils";

// How long a reverted replacement must see no call before it is released
const RETIRED_REPLACEMENT_IDLE_MS = 1000;

// `inFlight`: calls currently in a replacement, `finished`: calls that left it
export type ReplacementCalls = { inFlight: number; finished: number };

// `implementation` counting its calls in `calls`, for RetiredReplacements.revert()
export function countCalls(calls: ReplacementCalls, implementation: Java.MethodImplementation): Java.MethodImplementation {
  return function (this: Java.Wrapper, ...args: any[]) {
    calls.inFlight++;
    try {
      return implementation.apply(this, args);
    } finally {
      calls.inFlight--;
      calls.finished++;
    }
  };
}

// `finished`: the `calls.finished` count at the last check
type RetiredReplacement = { calls: ReplacementCalls; replacement: unknown; finished: number };

// The replacements of reverted methods, each kept until no thread can be inside it. Setting `implementation = null`
// drops frida-java-bridge's only reference to the replacement's cloned ArtMethod and NativeCallback, but a thread
// that ART already routed to the replacement, one in the original method (which can block for any time), waiting
// for the JS lock, or returning through ART's JNI trampoline still uses both. A GC in between crashes it, e.g. with
// a null dereference in the NativeCallback. Hot methods such as StringBuilder.append() are called by many threads at
// once, so unhooking them hits this. Released once no call is in flight and none finished for `idleMs`, which
// covers the short paths into the replacement and back through ART. The JIT never holds a replacement, see
// repairAccessFlags().
export class RetiredReplacements {
  private retired: RetiredReplacement[] = [];
  private releaseScheduled = false;

  constructor(private readonly idleMs = RETIRED_REPLACEMENT_IDLE_MS) {}

  // the replacements not released yet
  get size(): number {
    return this.retired.length;
  }

  // Reverts `method` to its original implementation. `calls` counts the calls of its replacement, see countCalls().
  // Throws if frida-java-bridge can't revert it.
  revert(method: Java.Method, calls: ReplacementCalls): void {
    const replacement = method.implementation;
    // null reverts the method to its original implementation
    method.implementation = null;
    this.retired.push({ calls, replacement, finished: calls.finished });
    this.scheduleRelease();
  }

  // Resolves with true once every replacement is released, or with false after `timeoutMs`
  async whenReleased(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.retired.length > 0) {
      if (Date.now() >= deadline) return false;
      await sleepMilliseconds(Math.min(50, this.idleMs));
    }
    return true;
  }

  private scheduleRelease(): void {
    if (this.releaseScheduled) return;
    this.releaseScheduled = true;
    setTimeout(() => {
      this.releaseScheduled = false;
      this.retired = this.retired.filter((retired) => {
        const { inFlight, finished } = retired.calls;
        const idle = inFlight === 0 && finished === retired.finished;
        retired.finished = finished;
        return !idle;
      });
      if (this.retired.length > 0) this.scheduleRelease();
    }, this.idleMs);
  }
}
