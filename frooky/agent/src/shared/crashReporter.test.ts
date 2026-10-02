import { installCrashReporter, isReportableException } from "./crashReporter";

describe("isReportableException()", () => {
  it("reports an abort, e.g. ART's after a JNI error", () => {
    expect(isReportableException("abort", false)).toBe(true);
  });

  it("reports an illegal instruction, e.g. from a hook in the middle of an instruction", () => {
    expect(isReportableException("illegal-instruction", false)).toBe(true);
  });

  it("ignores access violations outside hooked modules, which ART raises and handles itself", () => {
    expect(isReportableException("access-violation", false)).toBe(false);
  });

  it("reports access violations in a module with a native hook", () => {
    expect(isReportableException("access-violation", true)).toBe(true);
  });

  it("ignores breakpoints, e.g. from a debugger", () => {
    expect(isReportableException("breakpoint", false)).toBe(false);
  });
});

describe("installCrashReporter()", () => {
  it("installs no exception handler under V8", () => {
    const script = globalThis as unknown as { Script: { runtime: string } };
    const originalScript = script.Script;
    script.Script = { runtime: "V8" };
    const handlerSpy = spyOn(Process, "setExceptionHandler");
    try {
      installCrashReporter(
        { isInHookedModule: () => false, describeHooksInModulesOf: () => [], describeHookedFunctionAt: () => undefined },
        () => {},
      );
      expect(handlerSpy).not.toHaveBeenCalled();
    } finally {
      handlerSpy.mockRestore();
      script.Script = originalScript;
    }
  });
});
