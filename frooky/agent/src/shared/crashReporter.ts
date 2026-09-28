// A native exception that is about to kill the process, sent to the host.
export interface CrashReport {
  // Frida's exception type, e.g. `abort` or `access-violation`
  type: string;
  // e.g. `libc.so!abort+0xc0`
  address: string;
  // frames of the crashing thread that lie in a module, innermost first, starting with `address`
  backtrace: CrashFrame[];
  // installed native hooks (e.g. `libfoo.so+0x1a2b4`) in modules that appear in `backtrace`
  nativeHooks: string[];
}

export interface CrashFrame {
  // e.g. `0x7ea6c5247803 libfoo.so!Java_Foo_bar+0x43`
  frame: string;
  // the installed native hook whose function contains the frame, e.g. `libfoo.so+0x7b0`
  hook?: string;
}

// implemented by NativeHookManager
export interface CrashHookLookup {
  describeHooksInModulesOf(addresses: NativePointer[]): string[];
  describeHookedFunctionAt(address: NativePointer): string | undefined;
}

const MAX_BACKTRACE_FRAMES = 16;

// Whether a native exception is likely fatal. ART raises and handles access violations itself (implicit null
// and suspend checks, stack walks), so those are only reported if the thread runs through a hooked module.
export function isReportableException(type: string, inHookedModule: boolean): boolean {
  if (type === "access-violation") return inHookedModule;
  return type === "abort" || type === "illegal-instruction" || type === "arithmetic";
}

// Reports the first likely fatal native exception, before the process dies. Frida's own `crash` (with the
// `detached` signal) is empty for some crashes, e.g. ART aborting after a JNI error, and doesn't name hooks.
export function installCrashReporter(hooks: CrashHookLookup, report: (crash: CrashReport) => void): void {
  let reported = false;
  Process.setExceptionHandler((details) => {
    if (reported || !isReportableException(details.type, true)) return false;
    try {
      let frames: NativePointer[] = [];
      try {
        frames = Thread.backtrace(details.context, Backtracer.FUZZY);
      } catch (_) {
        // report without a backtrace
      }
      // the backtrace doesn't include the crashing instruction itself
      const addresses = [details.address, ...frames].filter((address) => DebugSymbol.fromAddress(address).moduleName !== null);
      const nativeHooks = hooks.describeHooksInModulesOf(addresses);
      if (!isReportableException(details.type, nativeHooks.length > 0)) return false;
      reported = true;
      report({
        type: details.type,
        address: DebugSymbol.fromAddress(details.address).toString(),
        backtrace: addresses
          .slice(0, MAX_BACKTRACE_FRAMES)
          .map((address) => ({ frame: DebugSymbol.fromAddress(address).toString(), hook: hooks.describeHookedFunctionAt(address) })),
        nativeHooks,
      });
    } catch (_) {
      // the reporter must never fail itself
    }
    // let ART's fault handler or the default handler deal with it
    return false;
  });
}
