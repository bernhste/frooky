// Native (C/C++) stack frames, the platform-independent part of a stack trace: each platform's
// PlatformStackTrace adds the frames of its managed runtime (e.g. Java on Android) to these.

// Frida 17 takes an options object with a limit, which stops the stack walk early (not in @types/frida-gum yet)
type BacktraceWithOptions = (context: CpuContext, options: { backtracer: Backtracer; limit: number }) => NativePointer[];
const backtrace = Thread.backtrace as unknown as BacktraceWithOptions;

// DebugSymbol.fromAddress() takes ~35 us per frame, and the same return addresses recur
const MAX_CACHED_SYMBOLS = 10_000;
const symbolCache = new Map<string, string>();

function formatNativeFrame(address: NativePointer): string {
  const key = address.toString();
  let frame = symbolCache.get(key);
  if (frame === undefined) {
    const sym = DebugSymbol.fromAddress(address);
    frame = `${sym.name ?? address} (${sym.moduleName}:${sym.address})`;
    if (symbolCache.size >= MAX_CACHED_SYMBOLS) symbolCache.clear();
    symbolCache.set(key, frame);
  }
  return frame;
}

// Up to `limit` native frames at `ctx` (an Interceptor callback's `this.context`), innermost first. `fuzzyOnly` skips the
// accurate backtracer, which needs the linker's lock (dl_iterate_phdr()) for return addresses it hasn't unwound before.
export function nativeStackFrames(ctx: CpuContext, limit: number, fuzzyOnly = false): string[] {
  try {
    // FUZZY also returns stack values that only look like return addresses, so it's only the fallback for
    // code without unwind information
    let frames = fuzzyOnly ? [] : backtrace(ctx, { backtracer: Backtracer.ACCURATE, limit });
    if (frames.length === 0) frames = backtrace(ctx, { backtracer: Backtracer.FUZZY, limit });
    return frames.map(formatNativeFrame);
  } catch (_) {
    return [];
  }
}
