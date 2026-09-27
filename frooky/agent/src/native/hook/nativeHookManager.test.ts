import { FrookyAgent } from "../../FrookyAgent";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { normalizeInputParams, normalizeInputRetType } from "../../shared/inputParsing/inputDecodableTypes";
import { InputNativeHookNormalized } from "../../shared/inputParsing/inputNativeHookCollection";
import { PlatformStackTrace } from "../../shared/platformStackTrace";
import { sleepMilliseconds } from "../../shared/utils";
import { NativeHookManager } from "./nativeHookManager";
import { NativeHook } from "./nativeHook";
import { NativeHookEvent } from "./nativeHookEvent";

// resolveHooks() only resolves module/symbol addresses, it never installs an implementation
// (that's registerHooks()'s job), so it's safe to run against real, always-loaded libc.so exports
// (malloc/free/atoi) without risking side effects on the host process - mirrors androidHookManager.test.ts.
const stackTrace: PlatformStackTrace = { build: () => [] };
const frookyAgent = {} as FrookyAgent;
// kept alive for the whole file: the Interceptor may still touch a function after detach()
const cm = new CModule("int countdown (int n) { return (n == 0) ? 0 : countdown (n - 1) + 1; }");

// Interceptor changes are only committed once no thread runs a JS callback, which can take a moment
// while the app keeps hitting other hooks (e.g. frida-java-bridge's), so call until the hook fires
async function untilHooked(call: () => void, fired: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !fired(); i++) {
    call();
    if (!fired()) await sleepMilliseconds(10);
  }
}

function nativeHook(module: string, symbol: string, overrides: Partial<InputNativeHookNormalized> = {}): InputNativeHookNormalized {
  return { module, symbol, hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS, ...overrides };
}

describe("NativeHookManager", () => {
  describe("resolveHooks()", () => {
    it("resolves an exported symbol to its real address in the module", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      const results = await Promise.all(await manager.resolveHooks([nativeHook("libc.so", "malloc")], 5));

      expect(results.length).toBe(1);
      const hooks = results[0] as NativeHook[];
      expect(hooks).not.toBeNull();
      expect(hooks.length).toBe(1);
      expect(hooks[0].symbolName).toBe("malloc");
      expect(hooks[0].moduleName).toBe("libc.so");
      expect(hooks[0].symbolAddress.toString()).toBe(Process.getModuleByName("libc.so").getExportByName("malloc").toString());
    });

    it("returns null when the module does not exist", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      // timeout 0, see androidHookManager.test.ts's equivalent case for why - this only cares
      // that an unresolved module surfaces as null, not how many attempts were made.
      const results = await Promise.all(await manager.resolveHooks([nativeHook("libDoesNotExist.so", "foo")], 0));

      expect(results).toEqual([null]);
    });

    it("returns null when the symbol does not exist in an otherwise resolved module", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      const results = await Promise.all(await manager.resolveHooks([nativeHook("libc.so", "thisSymbolDoesNotExist")], 2));

      expect(results).toEqual([null]);
    });

    it("resolves the module once and shares that same Module instance across every hook that references it", async () => {
      // Process.getModuleByName is a read-only native property here, so it can't be spied on -
      // instead this asserts on the module-caching itself: resolveHooks() creates one modulePromise
      // per unique module name and every hook in that group awaits the very same promise, so a
      // single resolution must produce reference-identical Module instances across hooks.
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      const results = await Promise.all(await manager.resolveHooks([nativeHook("libc.so", "malloc"), nativeHook("libc.so", "free")], 5));

      const [mallocHooks, freeHooks] = results as NativeHook[][];
      expect(mallocHooks[0].module).toBe(freeHooks[0].module);
    });

    it("processes hooks for different modules independently", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      const results = await Promise.all(
        await manager.resolveHooks([nativeHook("libc.so", "malloc"), nativeHook("liblog.so", "__android_log_print")], 5),
      );

      expect(results.length).toBe(2);
      expect(results.every((hooks) => hooks !== null && hooks.length === 1)).toBeTruthy();
    });

    it("resolves one group as null without aborting the sibling group when only one module fails to resolve", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      // The timeout is shared across every module in the batch (it's a single argument to
      // resolveHooks()), so it can't be 0 here the way the "module does not exist" case above
      // uses it - a 0s deadline never lets the poll loop attempt even the real, already-loaded
      // libc.so module once (see pollUntilResolved()), which would fail this test for the wrong reason.
      const results = await Promise.all(await manager.resolveHooks([nativeHook("libDoesNotExist.so", "foo"), nativeHook("libc.so", "malloc")], 1));

      expect(results.length).toBe(2);
      const [missingModuleResult, resolvedResult] = results;
      expect(missingModuleResult).toBeNull();
      expect((resolvedResult as NativeHook[])[0].symbolName).toBe("malloc");
    });
  });

  // installs a real Interceptor hook on libc's atoi() and calls it from the test; other threads of
  // the host process may call it too, so this only asserts on calls from before/after the detach
  describe("registerHooks() / unregisterHooks()", () => {
    it("detaches the Interceptor listener", async () => {
      const agent = { addEventToLog: fn() } as unknown as FrookyAgent;
      const manager = new NativeHookManager(stackTrace, agent);
      const [hooks] = await Promise.all(await manager.resolveHooks([nativeHook("libc.so", "atoi")], 5));
      const atoi = new NativeFunction(hooks![0].symbolAddress, "int", ["pointer"]);
      const input = Memory.allocUtf8String("42");

      expect(manager.registerHooks(hooks!)).toBe(1);
      expect(hooks![0].listener).toBeDefined();
      await untilHooked(
        () => atoi(input),
        () => (agent.addEventToLog as unknown as Mock).mock.calls.length > 0,
      );
      expect(atoi(input)).toBe(42);
      expect((agent.addEventToLog as unknown as Mock).mock.calls.length).toBeGreaterThan(0);

      manager.unregisterHooks(hooks!);
      expect(hooks![0].listener).toBeUndefined();
      (agent.addEventToLog as unknown as Mock).mockClear();
      expect(atoi(input)).toBe(42);
      expect((agent.addEventToLog as unknown as Mock).mock.calls.length).toBe(0);
    });

    it("keeps the arguments and stack trace of each call apart when calls overlap", async () => {
      // countdown(3) recurses down to countdown(0), so every onEnter runs before the first onLeave
      const events: NativeHookEvent[] = [];
      const agent = { addEventToLog: (event: NativeHookEvent) => events.push(event) } as unknown as FrookyAgent;
      let enterCount = 0;
      const countingStackTrace: PlatformStackTrace = { build: () => [`enter ${enterCount++}`] };
      const manager = new NativeHookManager(countingStackTrace, agent);
      const params = normalizeInputParams([["int", "n"]], DEFAULT_DECODER_SETTINGS);
      const retType = normalizeInputRetType("int", DEFAULT_DECODER_SETTINGS);
      const [hooks] = await Promise.all(await manager.resolveHooks([nativeHook("libc.so", "atoi", { params, retType })], 5));
      const hook: NativeHook = { ...hooks![0], symbolName: "countdown", symbolAddress: cm.countdown };

      manager.registerHooks([hook]);
      await untilHooked(
        () => new NativeFunction(cm.countdown, "int", ["int"])(0),
        () => events.length > 0,
      );
      events.length = 0;
      enterCount = 0;
      try {
        expect(new NativeFunction(cm.countdown, "int", ["int"])(3)).toBe(3);
      } finally {
        manager.unregisterHooks([hook]);
      }

      // events are added on leave, innermost call first; countdown(n) was entered as call number 3 - n
      expect(events.map((event) => [event.argsIn![0].value, event.returnValue!.value, event.stackTrace![0]])).toEqual([
        [0, 0, "enter 3"],
        [1, 1, "enter 2"],
        [2, 2, "enter 1"],
        [3, 3, "enter 0"],
      ]);
    });
  });
});

export {};
