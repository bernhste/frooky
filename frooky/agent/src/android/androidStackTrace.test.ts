import Java from "frida-java-bridge";
import { nativeStackFrames } from "../native/nativeStackTrace";
import { HookStackTrace } from "../shared/platformStackTrace";
import { FilterMismatchError, sleepMilliseconds } from "../shared/utils";
import { AndroidStackTrace } from "./androidStackTrace";

// runs fn on the app's main thread, which always has a java stack (the Looper frames)
function onMainThread<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    Java.perform(() => {
      Java.scheduleOnMainThread(() => {
        try {
          resolve(fn());
        } catch (e) {
          reject(e);
        }
      });
    });
  });
}

// what fn throws on the main thread, or undefined
function thrownBy(fn: () => unknown): Promise<unknown> {
  return onMainThread(fn).then(
    () => undefined,
    (e) => e,
  );
}

// kept alive for the whole file: the Interceptor may still touch a function after detach()
const cm = new CModule("int identity (int n) { return n; }");

// Interceptor changes are only committed once no thread runs a JS callback, which can take a moment
// while the app keeps hitting other hooks (e.g. frida-java-bridge's), so call until the hook fires
async function untilHooked(call: () => void, fired: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !fired(); i++) {
    call();
    if (!fired()) await sleepMilliseconds(10);
  }
}

// calls a native function and returns what build() and nativeStackFrames() produced from inside its hook
async function buildInNativeHook(limit: number): Promise<{ built: HookStackTrace; native: string[] }> {
  let result: { built: HookStackTrace; native: string[] } | undefined;
  const listener = Interceptor.attach(cm.identity, {
    onEnter() {
      result = { built: AndroidStackTrace.build(limit, undefined, this.context), native: nativeStackFrames(this.context, limit) };
    },
  });
  try {
    const identity = new NativeFunction(cm.identity, "int", ["int"]);
    await untilHooked(
      () => identity(1),
      () => result !== undefined,
    );
  } finally {
    listener.detach();
  }
  return result ?? { built: { platformStackTrace: [], nativeStackTrace: [] }, native: [] };
}

describe("AndroidStackTrace", () => {
  it("returns no frames without a limit or a filter", () => {
    expect(AndroidStackTrace.build(0)).toEqual({ platformStackTrace: [], nativeStackTrace: [] });
  });

  it("starts with the native frames when called with a context", async () => {
    const { built, native } = await buildInNativeHook(2);
    // the JS thread has no java frames, so all of them are native
    expect(native.length).toBeGreaterThan(0);
    expect(built.nativeStackTrace).toEqual(native);
    expect(built.platformStackTrace).toEqual([]);
  });

  it("captures at most limit java frames", async () => {
    const { platformStackTrace } = await onMainThread(() => AndroidStackTrace.build(2));
    expect(platformStackTrace.length).toBe(2);
    for (const frame of platformStackTrace) expect(/^[\w.$]+\.[\w$<>]+ \(.*:-?\d+\)$/.test(frame)).toBeTruthy();
  });

  it("searches the whole java stack without a limit, but returns no frames", async () => {
    expect(await onMainThread(() => AndroidStackTrace.build(0, ["^android\\.os\\.Looper\\.loop"]))).toEqual({
      platformStackTrace: [],
      nativeStackTrace: [],
    });
  });

  it("throws FilterMismatchError when no frame matches", async () => {
    expect((await thrownBy(() => AndroidStackTrace.build(0, ["^no\\.such\\.frame"]))) instanceof FilterMismatchError).toBeTruthy();
  });

  it("with a limit, only searches the captured frames", async () => {
    // ActivityThread.main is the bottom of the main thread's stack, never within its first frame
    expect((await thrownBy(() => AndroidStackTrace.build(1, ["ActivityThread\\.main"]))) instanceof FilterMismatchError).toBeTruthy();
    const { platformStackTrace } = await onMainThread(() => AndroidStackTrace.build(100, ["ActivityThread\\.main"]));
    expect(platformStackTrace.some((frame) => frame.includes("ActivityThread.main"))).toBeTruthy();
  });
});

export {};
