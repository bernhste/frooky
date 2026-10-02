import Java from "frida-java-bridge";
import { nativeStackFrames } from "../native/nativeStackTrace";
import { DEFAULT_HOOK_SETTINGS } from "../shared/defaultValues";
import { HookSettings } from "../shared/frookySettings";
import { UnsafeContext } from "../shared/platformStackTrace";
import { FilterMismatchError } from "../shared/utils";
import { sleepMilliseconds } from "../shared/utils";
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

const settings: HookSettings = DEFAULT_HOOK_SETTINGS;

type Variant = { unsafeContext?: UnsafeContext; callerFilter?: string[] };

// calls a native function and returns what build() produced (or threw) for each variant, and what
// nativeStackFrames() produced, all from inside the same hook call
async function buildInNativeHook(limit: number, variants: Variant[] = [{}]): Promise<{ built: unknown[]; native: string[] }> {
  let result: { built: unknown[]; native: string[] } | undefined;
  const listener = Interceptor.attach(cm.identity, {
    onEnter() {
      const built = variants.map(({ unsafeContext, callerFilter = [] }) => {
        try {
          return AndroidStackTrace.build(
            { ...settings, maxStackFrames: limit, nativeStackTrace: true, platformStackTrace: true, callerFilter },
            { ctx: this.context, unsafeContext, filterCallers: true },
          );
        } catch (e) {
          return e;
        }
      });
      result = { built, native: nativeStackFrames(this.context, limit) };
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
  return result ?? { built: [], native: [] };
}

// one hook for the whole file: attaching to the same function again after a detach can take a long
// time to be committed
describe("AndroidStackTrace.build() in an unsafe context", () => {
  it("captures no frames and names the reason, drops calls whose callerFilter can't be checked, and captures only native frames before the app is ready", async () => {
    const { built, native } = await buildInNativeHook(4, [
      { unsafeContext: "signal-stack" },
      { unsafeContext: "in-linker", callerFilter: [".*"] },
      { unsafeContext: "before-ready" },
      { unsafeContext: "before-ready", callerFilter: [".*"] },
    ]);
    const [signalStack, inLinkerFiltered, beforeReady, beforeReadyFiltered] = built;
    expect(signalStack).toEqual({ platformStackTrace: [], nativeStackTrace: [], skipped: "signal-stack" });
    expect(inLinkerFiltered instanceof FilterMismatchError).toBeTruthy();
    expect(native.length).toBeGreaterThan(0);
    expect(beforeReady).toEqual({ platformStackTrace: [], nativeStackTrace: native, skipped: "before-ready" });
    expect(beforeReadyFiltered instanceof FilterMismatchError).toBeTruthy();
  });
});

describe("AndroidStackTrace.build() with a callerFilter", () => {
  // on the main thread, which runs android.os.Looper.loop further down the stack
  const build = (callerFilter: string[], filterCallers = true) =>
    onMainThread(() => AndroidStackTrace.build({ ...settings, callerFilter }, { filterCallers }));
  const dropped = async (callerFilter: string[]) =>
    (await thrownBy(() => AndroidStackTrace.build({ ...settings, callerFilter }, { filterCallers: true }))) instanceof FilterMismatchError;

  it("records a call with a matching method anywhere on the Java stack, without capturing frames", async () => {
    expect(await build(["^android\\.os\\.Looper\\.loop$"])).toEqual({ platformStackTrace: [], nativeStackTrace: [] });
  });

  it("drops a call without a matching method", async () => {
    expect(await dropped(["^this\\.matches\\.nothing$"])).toBe(true);
  });

  it("doesn't match the innermost frame, the hooked method of a Java hook", async () => {
    const frames = await onMainThread(() =>
      AndroidStackTrace.build({ ...settings, platformStackTrace: true, maxStackFrames: 1 }, { filterCallers: false }),
    );
    const innermost = frames.platformStackTrace[0].replace(/ \(.*$/, "").replace(/[.$]/g, "\\$&");
    expect(await dropped([`^${innermost}$`])).toBe(true);
  });

  it("isn't checked without filterCallers", async () => {
    expect(await build(["^this\\.matches\\.nothing$"], false)).toEqual({ platformStackTrace: [], nativeStackTrace: [] });
  });
});

export {};
