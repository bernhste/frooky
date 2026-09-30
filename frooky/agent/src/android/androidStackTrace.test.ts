import Java from "frida-java-bridge";
import { nativeStackFrames } from "../native/nativeStackTrace";
import { HookStackTrace } from "../shared/platformStackTrace";
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

// calls a native function and returns what build() and nativeStackFrames() produced from inside its hook
async function buildInNativeHook(limit: number): Promise<{ built: HookStackTrace; native: string[] }> {
  let result: { built: HookStackTrace; native: string[] } | undefined;
  const listener = Interceptor.attach(cm.identity, {
    onEnter() {
      result = {
        built: AndroidStackTrace.build(
          { maxStackFrames: limit, stackTraceFilter: [], nativeStackTrace: true, platformStackTrace: true },
          this.context,
        ),
        native: nativeStackFrames(this.context, limit),
      };
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

export {};
