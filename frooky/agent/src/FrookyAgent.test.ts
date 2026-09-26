import { describeReload, FrookyAgent } from "./FrookyAgent";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "./shared/defaultValues";
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
): { agent: FrookyAgent; manager: HookManager<any, any, any> } {
  const agent = new FrookyAgent(
    "Android",
    validator,
    () => manager,
    fakeStackTrace,
    "none", // keep the constructor's own logging quiet; we assert on logger.* directly below
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
      expect(infoSpy).toHaveBeenCalledWith("Successfully hooked 1 Android methods from frooky configuration 'Test Config'");
    });

    it("logs an error and does not throw when the hook manager's resolveHooks() rejects", async () => {
      const rawManager = fakePlatformHookManager();
      rawManager.resolveHooks.mockRejectedValue(new Error("boom"));
      const { agent } = createAgent(fakePlatformHookValidator(["normalized-hook"]), rawManager as unknown as HookManager<any, any, any>);

      await expect(agent.loadFrookyConfig(makeConfig())).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith("Error while resolving platform hooks: Error: boom");
      expect(rawManager.registerHooks).not.toHaveBeenCalled();
    });

    it("does not report a hook count when every hook group failed to resolve", async () => {
      const rawManager = fakePlatformHookManager();
      rawManager.resolveHooks.mockResolvedValue([Promise.resolve(null)]);
      const { agent } = createAgent(fakePlatformHookValidator(["normalized-hook"]), rawManager as unknown as HookManager<any, any, any>);

      await agent.loadFrookyConfig(makeConfig());

      expect(rawManager.registerHooks).not.toHaveBeenCalled();
      const summaryLogged = infoSpy.mock.calls.some(([message]) => String(message).includes("Successfully hooked"));
      expect(summaryLogged).toBeFalsy();
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

    it("keeps the loaded hooks when the reloaded config is invalid", async () => {
      const { agent, rawManager } = setup(["a"]);
      const logSpy = spyOn(console, "log");

      try {
        await agent.loadFrookyConfig(makeConfig(), "/tmp/hooks.yaml");
        await agent.loadFrookyConfig({ metadata: { name: "No hookCollection" } } as InputFrookyConfig, "/tmp/hooks.yaml");

        expect(rawManager.unregisterHooks).not.toHaveBeenCalled();
        const lastLine = String(logSpy.mock.calls[logSpy.mock.calls.length - 1]?.[0]);
        expect(lastLine.startsWith("  Not reloaded hooks.yaml, keeping the previous version: ")).toBe(true);
      } finally {
        logSpy.mockRestore();
      }
    });

    it("prints one summary line per reload instead of 'Resolved Hooks'", async () => {
      const { agent } = setup(["a", "b"], ["b", "c"]);
      const logSpy = spyOn(console, "log");

      try {
        await agent.loadFrookyConfig(makeConfig(), "/tmp/hooks.yaml");
        await agent.loadFrookyConfig(makeConfig(), "/tmp/hooks.yaml");

        expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
          "Resolved Hooks: 2",
          "  Reloaded hooks.yaml: 1 added (1 method hooked), 1 removed, 1 unchanged",
        ]);
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe("describeReload()", () => {
    it("counts declarations and lists what the added ones resolved to", () => {
      expect(describeReload(2, 3, 1, 1, 0, 38)).toBe("2 added (3 methods hooked, 1 function hooked, 1 failed), 38 unchanged");
    });

    it("reports added declarations that resolved to nothing", () => {
      expect(describeReload(1, 0, 0, 0, 0, 0)).toBe("1 added (nothing hooked)");
    });

    it("reports only removals and says so when nothing changed", () => {
      expect(describeReload(0, 0, 0, 0, 1, 1)).toBe("1 removed, 1 unchanged");
      expect(describeReload(0, 0, 0, 0, 0, 5)).toBe("no changes");
    });
  });
});

export {};
