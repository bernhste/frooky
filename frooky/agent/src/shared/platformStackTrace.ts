export interface PlatformStackTrace {
  build(limit: number, stackTraceFilter?: string[], ctx?: CpuContext): string[];
}

/**
 * Builds the native frames of the current thread, e.g. `-[NSString length] (Foundation:0x1a2b3c)`.
 * Shared by all platforms, since native code can be called from any bridge (Java, Objective-C, Swift).
 *
 * @param limit - Maximum number of frames.
 * @param ctx - CPU context of the hooked function, if the frames should start there.
 * @returns The frames. Empty if the backtrace is not available.
 */
export function buildNativeFrames(limit: number, ctx?: CpuContext): string[] {
  try {
    return Thread.backtrace(ctx, Backtracer.FUZZY)
      .slice(0, limit)
      .map((addr) => {
        const sym = DebugSymbol.fromAddress(addr);
        return `${sym.name ?? addr} (${sym.moduleName}:${sym.address})`;
      });
  } catch (_) {
    return [];
  }
}
