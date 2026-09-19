import { buildNativeFrames, PlatformStackTrace } from "../shared/platformStackTrace";
import { FilterMismatchError } from "../shared/utils";

/**
 * iOS stack traces are native frames only, no matter which bridge (Objective-C, Swift) the hooked code was called through.
 * Objective-C methods and Swift functions show up with their symbol name if the symbols are available.
 */
export const IosStackTrace: PlatformStackTrace = {
  build(limit: number, stackTraceFilter?: string[], ctx?: CpuContext): string[] {
    const frames = buildNativeFrames(limit, ctx);

    if (stackTraceFilter && stackTraceFilter.length > 0) {
      const matches = frames.some((line) => stackTraceFilter.some((pattern) => new RegExp(pattern).test(line)));
      if (!matches) {
        throw new FilterMismatchError();
      }
    }
    return frames;
  },
};
