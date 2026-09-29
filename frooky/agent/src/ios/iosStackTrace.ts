import { nativeStackFrames } from "../native/nativeStackTrace";
import { compileStackTraceFilter, HookStackTrace, PlatformStackTrace } from "../shared/platformStackTrace";
import { FilterMismatchError } from "../shared/utils";

// Frames searched by a stackTraceFilter without a frame limit, e.g. for app frames below UIKit code
const FILTER_SEARCH_FRAMES = 128;

// iOS stack traces only have native frames: Objective-C methods and Swift functions are native code, and
// show up by their symbol name, e.g. `-[NSURLSession dataTaskWithRequest:] (CFNetwork:0x1a2b3c)`.
export const IosStackTrace: PlatformStackTrace = {
  build(limit: number, stackTraceFilter?: string[], ctx?: CpuContext): HookStackTrace {
    const hasFilter = stackTraceFilter !== undefined && stackTraceFilter.length > 0;
    // no frames and no filter: skip the backtrace
    if ((limit <= 0 && !hasFilter) || !ctx) {
      if (hasFilter) throw new FilterMismatchError();
      return { platformStackTrace: [], nativeStackTrace: [] };
    }

    // with a limit, the filter only searches the captured frames, as on Android
    const frames = nativeStackFrames(ctx, limit > 0 ? limit : FILTER_SEARCH_FRAMES);
    if (hasFilter) {
      const regExps = compileStackTraceFilter(stackTraceFilter);
      if (!frames.some((frame) => regExps.some((regExp) => regExp.test(frame)))) {
        throw new FilterMismatchError();
      }
    }
    return { platformStackTrace: [], nativeStackTrace: limit > 0 ? frames : [] };
  },
};
