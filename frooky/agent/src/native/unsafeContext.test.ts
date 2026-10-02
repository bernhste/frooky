import { detectUnsafeContext, enterLinker, leaveLinker, markTargetReady, stackBounds, watchLinker } from "./unsafeContext";

// NDK libraries the dialer doesn't load, one of them is loaded by the "in-linker" test
const UNLOADED_LIBRARY_CANDIDATES = ["libsensorndk.so", "libtextclassifier_hash.so", "libneuralnetworks.so"];

describe("detectUnsafeContext()", () => {
  it("returns undefined for a normal call once the target is ready", () => {
    markTargetReady();
    const bounds = stackBounds();
    expect(bounds).not.toBeNull();
    // the middle of the current thread's stack
    const sp = bounds!.low.add(bounds!.high.sub(bounds!.low).shr(1));
    expect(detectUnsafeContext({ sp } as CpuContext)).toBeUndefined();
  });

  it("returns low-stack near the end of the thread's stack", () => {
    const bounds = stackBounds()!;
    expect(detectUnsafeContext({ sp: bounds.low.add(1024) } as CpuContext)).toBe("low-stack");
  });

  it("returns in-linker while dlopen() runs on the thread", () => {
    watchLinker();
    // onAdded runs inside the linker, on the thread that loads the module. A library that fails to load
    // still adds its dependencies first, e.g. libsensor.so for libsensorndk.so.
    const detected: (string | undefined)[] = [];
    const observer = Process.attachModuleObserver({
      onAdded() {
        detected.push(detectUnsafeContext());
      },
    });
    // through libdl like an app's dlopen(), not Module.load()
    const dlopen = new NativeFunction(Process.getModuleByName("libdl.so").getExportByName("dlopen"), "pointer", ["pointer", "int"]);
    try {
      // attaching the observer reports the loaded modules, which aren't in dlopen()
      detected.length = 0;
      for (const library of UNLOADED_LIBRARY_CANDIDATES) {
        // RTLD_NOW
        dlopen(Memory.allocUtf8String(library), 2);
        if (detected.length > 0) break;
      }
    } finally {
      observer.detach();
    }
    expect(detected.length).toBeGreaterThan(0);
    expect(detected.every((reason) => reason === "in-linker")).toBeTruthy();
    expect(detectUnsafeContext()).toBeUndefined();
  });

  it("returns linker-busy while dlopen() runs on another thread", () => {
    // a thread id that isn't this thread's
    const otherThreadId = Process.getCurrentThreadId() + 1;
    enterLinker(otherThreadId);
    try {
      expect(detectUnsafeContext()).toBe("linker-busy");
    } finally {
      leaveLinker(otherThreadId);
    }
    expect(detectUnsafeContext()).toBeUndefined();
  });
});

export {};
