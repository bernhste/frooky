import { FrookyAgent } from "../../FrookyAgent";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { InputNativeHookNormalized } from "../../shared/inputParsing/inputNativeHookCollection";
import { PlatformStackTrace } from "../../shared/platformStackTrace";
import { NativeHookManager } from "./nativeHookManager";
import { NativeHook } from "./nativeHook";

// resolveHooks() only resolves module/symbol addresses, it never installs an implementation
// (that's registerHooks()'s job), so it's safe to run against real, always-loaded libc.so exports
// (malloc/free/atoi) without risking side effects on the host process - mirrors androidHookManager.test.ts.
const stackTrace: PlatformStackTrace = { build: () => [] };
const frookyAgent = {} as FrookyAgent;

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
      const results = await Promise.all(
        await manager.resolveHooks([nativeHook("libDoesNotExist.so", "foo"), nativeHook("libc.so", "malloc")], 1),
      );

      expect(results.length).toBe(2);
      const [missingModuleResult, resolvedResult] = results;
      expect(missingModuleResult).toBeNull();
      expect((resolvedResult as NativeHook[])[0].symbolName).toBe("malloc");
    });
  });
});

export {};
