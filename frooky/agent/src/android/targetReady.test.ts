import Java from "frida-java-bridge";
import { FrookyAgent } from "../FrookyAgent";
import { PlatformStackTrace } from "../shared/platformStackTrace";
import { sleepMilliseconds } from "../shared/utils";
import { AndroidHookManager } from "./hook/androidHookManager";
import { Gate, TargetReady } from "./targetReady";

const stackTrace: PlatformStackTrace = { build: () => ({ javaStackTrace: [], nativeStackTrace: [] }) };

// runs fn on the app's main thread
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

// true if `promise` hasn't settled within 100 ms
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([promise.then(() => false), sleepMilliseconds(100).then(() => true)]);
}

describe("Gate", () => {
  it("lets a thread wait until it is opened, while the agent's own thread keeps running", async () => {
    const gate = new Gate();
    const waited = onMainThread(() => gate.wait());

    expect(await isPending(waited)).toBe(true);
    expect(gate.isOpen).toBe(false);

    gate.open();
    await waited;
    expect(gate.isOpen).toBe(true);
  });

  it("doesn't wait once it is open, on any number of threads", async () => {
    const gate = new Gate();
    gate.open();

    gate.wait();
    await onMainThread(() => gate.wait());
    await onMainThread(() => gate.wait());
  });
});

// These hook java.lang.Integer.reverse(int), which only the test calls, and revert their hooks.
describe("AndroidHookManager.holdBack() with a Gate", () => {
  it("holds a call of the method back on its thread until the gate opens", async () => {
    const manager = new AndroidHookManager(stackTrace, {} as FrookyAgent);
    const gate = new Gate();
    const reverse = Java.use("java.lang.Integer").reverse.overload("int");
    try {
      manager.holdBack(reverse, "reverse", () => gate.wait());
      const called = onMainThread(() => Java.use("java.lang.Integer").reverse(1));

      expect(await isPending(called)).toBe(true);

      gate.open();
      expect(await called).toBe(-2147483648);
    } finally {
      gate.open();
      await manager.prepareDetach();
    }
  });
});

describe("TargetReady", () => {
  it("resolves right away in an app that is already running, and holds nothing back", async () => {
    const targetReady = new TargetReady();
    await targetReady.promise;
    const manager = new AndroidHookManager(stackTrace, {} as FrookyAgent);
    const loadedApk = Java.use("android.app.LoadedApk");
    const methodName = "makeApplicationInner" in loadedApk ? "makeApplicationInner" : "makeApplication";

    targetReady.holdBackApp(manager, new Promise<void>(() => {}));

    for (const overload of loadedApk[methodName].overloads) expect(overload.implementation).toBeNull();
  });
});
