import { describeHooked, describeLoad, describeReady, FrookyAgent, HookProgress } from "./FrookyAgent";
import {
  DEFAULT_DECODER_SETTINGS,
  DEFAULT_HOOK_SETTINGS,
  DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
  PROGRESS_INTERVAL_MS,
} from "./shared/defaultValues";
import { stopEventSender } from "./shared/event/eventSender";
import { InputFrookyConfig } from "./shared/frookyConfig";
import { Hook } from "./shared/hook/hook";
import { HookManager } from "./shared/hook/hookManager";
import { HookValidator } from "./shared/hook/hookValidator";
import { logger } from "./shared/logger";
import { PlatformStackTrace } from "./shared/platformStackTrace";

const fakeStackTrace: PlatformStackTrace = { build: () => [] };

function fakeHook(overrides: Partial<Hook> = {}): Hook {
  return { hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS, ...overrides };
}

// FrookyAgent only ever calls resolveHooks()/registerHooks()/unregisterHooks() on the platform hook manager
// it is handed, so a plain fake covering those methods stands in for the real (Android/iOS) one.
function fakePlatformHookManager(): { resolveHooks: Mock; registerHooks: Mock; unregisterHooks: Mock } {
  return {
    resolveHooks: fn(async (): Promise<Promise<Hook[] | null>[]> => []),
    registerHooks: fn((): number => 0),
    unregisterHooks: fn((): void => {}),
  };
}

// resolves every normalized hook (a string in these tests) to one fake hook tagged with its name
function fakeResolvingHookManager(): { resolveHooks: Mock; registerHooks: Mock; unregisterHooks: Mock } {
  const manager = fakePlatformHookManager();
  manager.resolveHooks.mockImplementation(async (inputHooks: string[]) =>
    inputHooks.map((name) => Promise.resolve([fakeHook({ retType: { type: name } as Hook["retType"] })])),
  );
  manager.registerHooks.mockImplementation((hooks: Hook[]) => hooks.length);
  return manager;
}

function resolvedNames(call: unknown[]): string[] {
  return call[0] as string[];
}

function hookNames(call: unknown[]): string[] {
  return (call[0] as Hook[]).map((hook) => hook.retType!.type);
}

function fakePlatformHookValidator(normalizedHooks: unknown[] = []): HookValidator<any, any> {
  return {
    validateAndNormalizeHooks: fn(() => normalizedHooks),
    getPlatformHookCollections: fn(() => []),
  } as unknown as HookValidator<any, any>;
}

function createAgent(
  validator: HookValidator<any, any>,
  manager: HookManager<any, any, any>,
  reportProgress?: (progress: HookProgress) => void,
): { agent: FrookyAgent; manager: HookManager<any, any, any> } {
  const agent = new FrookyAgent(
    "Android",
    validator,
    () => manager,
    fakeStackTrace,
    "none", // keep the constructor's own logging quiet; we assert on logger.* directly below
    "console",
    DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
    reportProgress,
  );
  return { agent, manager };
}

function makeConfig(overrides: Partial<InputFrookyConfig> = {}): InputFrookyConfig {
  return {
    metadata: { name: "Test Config", platform: "Android" },
    settings: { hookSettings: { ...DEFAULT_HOOK_SETTINGS }, decoderSettings: { ...DEFAULT_DECODER_SETTINGS } },
    hookCollection: [],
    ...overrides,
  };
}

describe("FrookyAgent", () => {
  let warnSpy: Mock;
  let errorSpy: Mock;
  let infoSpy: Mock;

  beforeEach(() => {
    warnSpy = spyOn(logger, "warn");
    errorSpy = spyOn(logger, "error");
    infoSpy = spyOn(logger, "info");
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
    // every `new FrookyAgent(...)` starts the (module-global) event sender interval
    stopEventSender();
  });

  describe("loadFrookyConfig()", () => {
    it("warns and never touches the hook manager when the config fails schema validation", async () => {
      const rawManager = fakePlatformHookManager();
      const { agent } = createAgent(fakePlatformHookValidator(), rawManager as unknown as HookManager<any, any, any>);
      const invalidConfig = { metadata: { name: "No hookCollection" } } as InputFrookyConfig;

      await agent.loadFrookyConfig(invalidConfig);

      expect(rawManager.resolveHooks).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });

    it("registers exactly the hook groups that resolved successfully and reports their count", async () => {
      const hookA = fakeHook();
      const rawManager = fakePlatformHookManager();
      rawManager.resolveHooks.mockResolvedValue([Promise.resolve([hookA]), Promise.resolve(null)]);
      rawManager.registerHooks.mockReturnValue(1);
      const { agent } = createAgent(
        fakePlatformHookValidator(["normalized-hook-a", "normalized-hook-b"]),
        rawManager as unknown as HookManager<any, any, any>,
      );

      await agent.loadFrookyConfig(makeConfig());

      expect(rawManager.registerHooks).toHaveBeenCalledTimes(1);
      expect(rawManager.registerHooks).toHaveBeenCalledWith([hookA]);
      expect(infoSpy).toHaveBeenCalledWith("Loaded Test Config: 2 new; hooked 1 method, 1 not resolved");
    });

    it("logs an error and does not throw when the hook manager's resolveHooks() rejects", async () => {
      const rawManager = fakePlatformHookManager();
      rawManager.resolveHooks.mockRejectedValue(new Error("boom"));
      const { agent } = createAgent(fakePlatformHookValidator(["normalized-hook"]), rawManager as unknown as HookManager<any, any, any>);

      await expect(agent.loadFrookyConfig(makeConfig())).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith("Error while resolving platform hooks: Error: boom");
      expect(rawManager.registerHooks).not.toHaveBeenCalled();
    });

    it("reports every hook as not resolved when every hook group failed to resolve", async () => {
      const rawManager = fakePlatformHookManager();
      rawManager.resolveHooks.mockResolvedValue([Promise.resolve(null)]);
      const { agent } = createAgent(fakePlatformHookValidator(["normalized-hook"]), rawManager as unknown as HookManager<any, any, any>);

      await agent.loadFrookyConfig(makeConfig());

      expect(rawManager.registerHooks).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledWith("Loaded Test Config: 1 new; hooked nothing, 1 not resolved");
    });
  });

  describe("loadFrookyConfigs()", () => {
    it("logs an error for a config whose hook manager throws synchronously, and still loads the remaining configs", async () => {
      const rawManager = fakePlatformHookManager();
      // A resolveHooks() implementation that throws outright (rather than returning a rejected
      // promise) must only fail its own config, not the whole batch.
      rawManager.resolveHooks.mockImplementationOnce(() => {
        throw new Error("synchronous boom");
      });
      rawManager.resolveHooks.mockResolvedValueOnce([]);
      const { agent } = createAgent(fakePlatformHookValidator(["normalized-hook"]), rawManager as unknown as HookManager<any, any, any>);

      await agent.loadFrookyConfigs([makeConfig({ metadata: { name: "Broken" } }), makeConfig({ metadata: { name: "Healthy" } })]);

      expect(rawManager.resolveHooks).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith("Error while resolving platform hooks: Error: synchronous boom");
    });

    it("logs one 'Hooks ready' line for all configs once they are resolved", async () => {
      const rawManager = fakeResolvingHookManager();
      const validator = fakePlatformHookValidator();
      (validator.validateAndNormalizeHooks as unknown as Mock).mockReturnValueOnce(["a", "b"]);
      (validator.validateAndNormalizeHooks as unknown as Mock).mockReturnValueOnce(["c"]);
      const { agent } = createAgent(validator, rawManager as unknown as HookManager<any, any, any>);

      await agent.loadFrookyConfigs([makeConfig(), makeConfig()], ["first.yaml", "second.yaml"]);

      expect(infoSpy.mock.calls.map((call) => call[0])).toEqual(["Hooks ready: 3 hooked (3 methods)"]);
    });
  });

  describe("loadFrookyConfig() with a config id (reload)", () => {
    function setup(...hookSets: string[][]) {
      const rawManager = fakeResolvingHookManager();
      const validator = fakePlatformHookValidator();
      for (const hooks of hookSets) {
        (validator.validateAndNormalizeHooks as unknown as Mock).mockReturnValueOnce(hooks);
      }
      const { agent } = createAgent(validator, rawManager as unknown as HookManager<any, any, any>);
      return { agent, rawManager };
    }

    it("does not resolve or touch any hook when the reloaded config is unchanged", async () => {
      const { agent, rawManager } = setup(["a", "b"], ["b", "a"]);

      await agent.loadFrookyConfig(makeConfig(), "hooks.yaml");
      await agent.loadFrookyConfig(makeConfig(), "hooks.yaml");

      expect(rawManager.resolveHooks).toHaveBeenCalledTimes(1);
      expect(rawManager.unregisterHooks).not.toHaveBeenCalled();
    });

    it("only resolves added hooks and only unregisters removed ones", async () => {
      const { agent, rawManager } = setup(["a", "b"], ["b", "c"]);

      await agent.loadFrookyConfig(makeConfig(), "hooks.yaml");
      await agent.loadFrookyConfig(makeConfig(), "hooks.yaml");

      expect(rawManager.resolveHooks).toHaveBeenCalledTimes(2);
      expect(resolvedNames(rawManager.resolveHooks.mock.calls[1])).toEqual(["c"]);
      expect(rawManager.unregisterHooks).toHaveBeenCalledTimes(1);
      expect(hookNames(rawManager.unregisterHooks.mock.calls[0])).toEqual(["a"]);
    });

    it("treats configs with different ids independently", async () => {
      const { agent, rawManager } = setup(["a"], ["b"]);

      await agent.loadFrookyConfig(makeConfig(), "first.yaml");
      await agent.loadFrookyConfig(makeConfig(), "second.yaml");

      expect(rawManager.resolveHooks).toHaveBeenCalledTimes(2);
      expect(rawManager.unregisterHooks).not.toHaveBeenCalled();
    });

    it("never installs a hook that was removed while it was still resolving", async () => {
      const { agent, rawManager } = setup(["slow"], []);
      let resolveSlow: (hooks: Hook[]) => void = () => {};
      rawManager.resolveHooks.mockImplementationOnce(async () => [new Promise<Hook[]>((resolve) => (resolveSlow = resolve))]);

      const firstLoad = agent.loadFrookyConfig(makeConfig(), "hooks.yaml");
      await agent.loadFrookyConfig(makeConfig(), "hooks.yaml");
      resolveSlow([fakeHook()]);
      await firstLoad;

      expect(rawManager.registerHooks).not.toHaveBeenCalled();
      expect(rawManager.unregisterHooks).not.toHaveBeenCalled();
    });

    it("does not retry unchanged hooks that failed to resolve in the previous version", async () => {
      const { agent, rawManager } = setup(["a", "b"], ["a", "c"]);
      rawManager.resolveHooks.mockResolvedValueOnce([Promise.resolve(null), Promise.resolve([fakeHook()])]);

      await agent.loadFrookyConfig(makeConfig(), "hooks.yaml");
      await agent.loadFrookyConfig(makeConfig(), "hooks.yaml");

      expect(rawManager.resolveHooks).toHaveBeenCalledTimes(2);
      expect(resolvedNames(rawManager.resolveHooks.mock.calls[1])).toEqual(["c"]);
    });

    it("retries only the failed hooks when asked to, leaving installed ones in place", async () => {
      const { agent, rawManager } = setup(["a", "b"], ["a", "b"]);
      rawManager.resolveHooks.mockResolvedValueOnce([Promise.resolve(null), Promise.resolve([fakeHook()])]);

      await agent.loadFrookyConfig(makeConfig(), "/tmp/hooks.yaml");
      await agent.loadFrookyConfig(makeConfig(), "/tmp/hooks.yaml", true);

      expect(rawManager.resolveHooks).toHaveBeenCalledTimes(2);
      expect(resolvedNames(rawManager.resolveHooks.mock.calls[1])).toEqual(["a"]);
      expect(rawManager.unregisterHooks).not.toHaveBeenCalled();
      expect(infoSpy.mock.calls[1]?.[0]).toBe("Reloaded hooks.yaml: 1 retried, 1 unchanged; hooked 1 method");
    });

    it("keeps the loaded hooks when the reloaded config is invalid", async () => {
      const { agent, rawManager } = setup(["a"]);

      await agent.loadFrookyConfig(makeConfig(), "/tmp/hooks.yaml");
      await agent.loadFrookyConfig({ metadata: { name: "No hookCollection" } } as InputFrookyConfig, "/tmp/hooks.yaml");

      expect(rawManager.unregisterHooks).not.toHaveBeenCalled();
      const lastWarning = String(warnSpy.mock.calls[warnSpy.mock.calls.length - 1]?.[0]);
      expect(lastWarning.startsWith("Not reloaded hooks.yaml, keeping the previous version: ")).toBe(true);
    });

    it("logs one summary line per load", async () => {
      const { agent } = setup(["a", "b"], ["b", "c"]);

      await agent.loadFrookyConfig(makeConfig(), "/tmp/hooks.yaml");
      await agent.loadFrookyConfig(makeConfig(), "/tmp/hooks.yaml");

      expect(infoSpy.mock.calls.map((call) => call[0])).toEqual([
        "Loaded hooks.yaml: 2 new; hooked 2 methods",
        "Updated hooks.yaml: 1 new, 1 removed, 1 unchanged; hooked 1 method",
      ]);
    });

    it("counts a changed declaration of the same method as updated", async () => {
      const rawManager = fakeResolvingHookManager();
      const validator = fakePlatformHookValidator();
      const before = { javaClass: "com.example.Foo", method: "bar" };
      const after = { javaClass: "com.example.Foo", method: "bar", overloads: [{ params: ["int"] }] };
      const other = { javaClass: "com.example.Foo", method: "baz" };
      (validator.validateAndNormalizeHooks as unknown as Mock).mockReturnValueOnce([before, other]);
      (validator.validateAndNormalizeHooks as unknown as Mock).mockReturnValueOnce([after]);
      const { agent } = createAgent(validator, rawManager as unknown as HookManager<any, any, any>);

      await agent.loadFrookyConfig(makeConfig(), "/tmp/hooks.yaml");
      await agent.loadFrookyConfig(makeConfig(), "/tmp/hooks.yaml");

      expect(infoSpy.mock.calls[1]?.[0]).toBe("Updated hooks.yaml: 1 updated, 1 removed; hooked 1 method");
    });
  });

  describe("hook progress", () => {
    const hookA1 = { javaClass: "com.example.A", method: "one" };
    const hookA2 = { javaClass: "com.example.A", method: "two" };
    const hookB = { javaClass: "com.example.B", method: "three" };

    // resolves class B at once and leaves class A pending until the returned function is called
    function setupWithPendingClass(reportProgress?: (progress: HookProgress) => void) {
      const rawManager = fakeResolvingHookManager();
      let resolveClassA: (hooks: Hook[] | null) => void = () => {};
      const classA = new Promise<Hook[] | null>((resolve) => (resolveClassA = resolve));
      rawManager.resolveHooks.mockImplementationOnce(async () => [classA, classA, Promise.resolve([fakeHook()])]);
      const { agent } = createAgent(
        fakePlatformHookValidator([hookA1, hookA2, hookB]),
        rawManager as unknown as HookManager<any, any, any>,
        reportProgress,
      );
      return { agent, resolveClassA: (hooks: Hook[] | null) => resolveClassA(hooks) };
    }

    it("counts installed hooks and the classes still being looked up", async () => {
      const { agent, resolveClassA } = setupWithPendingClass();

      const loading = agent.loadFrookyConfig(makeConfig(), "hooks.yaml");
      await new Promise((r) => setTimeout(r, 10));

      expect(agent.hookProgress()).toEqual({ hooked: 1, pending: 1 });

      resolveClassA(null);
      await loading;

      expect(agent.hookProgress()).toEqual({ hooked: 1, pending: 0 });
    });

    it("marks a hook whose resolving rejected as failed instead of leaving it pending", async () => {
      const rawManager = fakeResolvingHookManager();
      rawManager.resolveHooks.mockImplementationOnce(async () => [Promise.reject(new Error("no such overload")), Promise.resolve([fakeHook()])]);
      const { agent } = createAgent(fakePlatformHookValidator([hookA1, hookB]), rawManager as unknown as HookManager<any, any, any>);

      await agent.loadFrookyConfig(makeConfig(), "hooks.yaml");

      expect(agent.hookProgress()).toEqual({ hooked: 1, pending: 0 });
      expect(warnSpy).toHaveBeenCalledWith("Failed to hook com.example.A.one: no such overload");
      expect(infoSpy).toHaveBeenCalledWith("Loaded hooks.yaml: 2 new; hooked 1 method, 1 not resolved");
    });

    it("reports the progress, throttled, ending with nothing pending", async () => {
      const reports: HookProgress[] = [];
      const { agent, resolveClassA } = setupWithPendingClass((progress) => reports.push(progress));

      const loading = agent.loadFrookyConfig(makeConfig(), "hooks.yaml");
      await new Promise((r) => setTimeout(r, PROGRESS_INTERVAL_MS + 50));
      resolveClassA([fakeHook()]);
      await loading;
      await new Promise((r) => setTimeout(r, PROGRESS_INTERVAL_MS + 50));

      expect(reports).toEqual([
        { hooked: 1, pending: 1 },
        { hooked: 3, pending: 0 },
      ]);
    });
  });

  describe("describeLoad()", () => {
    const none = { added: 0, updated: 0, removed: 0, retried: 0, unchanged: 0, hookedMethods: 0, hookedFunctions: 0, failed: 0 };

    it("lists the changes, then what the new, updated and retried declarations resolved to", () => {
      expect(describeLoad({ ...none, added: 2, updated: 1, hookedMethods: 3, hookedFunctions: 1, failed: 1, unchanged: 38 })).toBe(
        "2 new, 1 updated, 38 unchanged; hooked 3 methods and 1 function, 1 not resolved",
      );
    });

    it("lists retried declarations", () => {
      expect(describeLoad({ ...none, retried: 4, failed: 4, unchanged: 35 })).toBe("4 retried, 35 unchanged; hooked nothing, 4 not resolved");
    });

    it("leaves out the hooked part when only removing", () => {
      expect(describeLoad({ ...none, removed: 1, unchanged: 1 })).toBe("1 removed, 1 unchanged");
    });

    it("says so when nothing changed", () => {
      expect(describeLoad({ ...none, unchanged: 5 })).toBe("no changes");
    });
  });

  describe("describeHooked()", () => {
    it("uses singular and plural", () => {
      expect(describeHooked({ hookedMethods: 1, hookedFunctions: 2, failed: 0 })).toBe("hooked 1 method and 2 functions");
    });
  });

  describe("describeReady()", () => {
    it("reports the total and splits it by kind", () => {
      expect(describeReady({ hookedMethods: 30, hookedFunctions: 8, failed: 4 })).toBe(
        "Hooks ready: 38 hooked (30 methods, 8 functions), 4 not resolved",
      );
    });

    it("reports when nothing was hooked", () => {
      expect(describeReady({ hookedMethods: 0, hookedFunctions: 0, failed: 0 })).toBe("Hooks ready: 0 hooked");
    });
  });
});

export {};
