import { FrookyAgent } from "./FrookyAgent";
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

// FrookyAgent only ever calls resolveHooks()/registerHooks() on the platform hook manager it is
// handed, so a plain fake covering those two methods stands in for the real (Android/iOS) one.
function fakePlatformHookManager(): { resolveHooks: Mock; registerHooks: Mock } {
  return {
    resolveHooks: fn(async (): Promise<Promise<Hook[] | null>[]> => []),
    registerHooks: fn((): number => 0),
  };
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
      const { agent } = createAgent(fakePlatformHookValidator(["normalized-hook"]), rawManager as unknown as HookManager<any, any, any>);

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
      // promise) isn't caught by loadFrookyConfig()'s own .catch() - only loadFrookyConfigs()'s
      // per-config try/catch stands between a single bad platform implementation and the whole batch.
      rawManager.resolveHooks.mockImplementationOnce(() => {
        throw new Error("synchronous boom");
      });
      rawManager.resolveHooks.mockResolvedValueOnce([]);
      const { agent } = createAgent(fakePlatformHookValidator(["normalized-hook"]), rawManager as unknown as HookManager<any, any, any>);

      await agent.loadFrookyConfigs([makeConfig({ metadata: { name: "Broken" } }), makeConfig({ metadata: { name: "Healthy" } })]);

      expect(rawManager.resolveHooks).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith("Error during loading of the frooky config: Error: synchronous boom");
    });
  });
});

export {};
