// Threads that run frooky's code for a hook (decoding, stack traces, sending the event). Hooked methods and
// functions that this code calls, e.g. `toString()` while decoding a Java object, `readlink` in `decoder: fd`
// or `ArrayList.add()` in frida-java-bridge, run without their hooks: otherwise they recurse until the thread's
// stack overflows. Shared by Java and native hooks, so neither records the calls the other's code makes.
const threadsInHookCode = new Set<number>();

// Marks the current thread as running hook code and returns its id, or returns undefined if it already does.
// Every id returned must be passed to leaveHookCode().
export function enterHookCode(): number | undefined {
  const tid = Process.getCurrentThreadId();
  if (threadsInHookCode.has(tid)) return undefined;
  threadsInHookCode.add(tid);
  return tid;
}

export function leaveHookCode(tid: number): void {
  threadsInHookCode.delete(tid);
}
