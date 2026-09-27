/** What the agent knows about a native exception that is about to kill the process. */
export interface CrashReport {
  /** Frida's exception type, e.g. `abort` or `access-violation`. */
  type: string;
  /** Where the exception happened, symbolized, e.g. `libc.so!abort+0xc0`. */
  address: string;
  /** The frames of the crashing thread that lie in a module, innermost first, starting with `address`. */
  backtrace: CrashFrame[];
  /** The installed native hooks (e.g. `libfoo.so+0x1a2b4`) in modules that appear in `backtrace`. */
  nativeHooks: string[];
}

export interface CrashFrame {
  /** The symbolized frame, e.g. `0x7ea6c5247803 libfoo.so!Java_Foo_bar+0x43`. */
  frame: string;
  /** The installed native hook whose function the frame lies in, e.g. `libfoo.so+0x7b0`. */
  hook?: string;
}

/** Looks up the installed native hooks for a crash report, see NativeHookManager. */
export interface CrashHookLookup {
  /** Names the installed native hooks in the modules that contain any of `addresses`. */
  describeHooksInModulesOf(addresses: NativePointer[]): string[];
  /** Names the installed native hook whose function `address` lies in. */
  describeHookedFunctionAt(address: NativePointer): string | undefined;
}

const MAX_BACKTRACE_FRAMES = 16;

/**
 * Whether a native exception is worth reporting. Frida only lets it through (the handler returns false), so this
 * must not report exceptions the app survives: ART raises and handles access violations on its own (implicit null
 * and suspend checks, stack walks), so those are only reported when the crashing thread runs through a module with
 * a native hook.
 */
export function isReportableException(type: string, inHookedModule: boolean): boolean {
  if (type === "access-violation") return inHookedModule;
  return type === "abort" || type === "illegal-instruction" || type === "arithmetic";
}

/**
 * Sends a {@link CrashReport} for the first native exception that is likely fatal, before the process dies. On
 * Android, Frida's own `crash` (passed to the host with the `detached` signal) is empty for some crashes, e.g. ART
 * aborting after a JNI error, and never names the hooks involved.
 *
 * @param hooks - Looks up the installed native hooks, to name the ones involved.
 * @param report - Sends the report to the host.
 */
export function installCrashReporter(hooks: CrashHookLookup, report: (crash: CrashReport) => void): void {
  let reported = false;
  Process.setExceptionHandler((details) => {
    if (reported || !isReportableException(details.type, true)) return false;
    try {
      let frames: NativePointer[] = [];
      try {
        frames = Thread.backtrace(details.context, Backtracer.FUZZY);
      } catch (_) {
        // the report without a backtrace is still worth sending
      }
      // the fuzzy backtrace does not start at the crashing instruction itself
      const addresses = [details.address, ...frames].filter((address) => DebugSymbol.fromAddress(address).moduleName !== null);
      const nativeHooks = hooks.describeHooksInModulesOf(addresses);
      if (!isReportableException(details.type, nativeHooks.length > 0)) return false;
      reported = true;
      report({
        type: details.type,
        address: DebugSymbol.fromAddress(details.address).toString(),
        // a frame without hook has no `hook` key once sent as JSON
        backtrace: addresses
          .slice(0, MAX_BACKTRACE_FRAMES)
          .map((address) => ({ frame: DebugSymbol.fromAddress(address).toString(), hook: hooks.describeHookedFunctionAt(address) })),
        nativeHooks,
      });
    } catch (_) {
      // never let the reporter itself turn an exception the app would survive into a different failure
    }
    // let the app (ART's fault handler) or the default handler deal with it
    return false;
  });
}
