import { NativeHookManager } from "./native/hook/nativeHookManager";
import { NativeHookValidator } from "./native/hook/nativeHookValidator";
import { markTargetReady, watchLinker } from "./native/unsafeContext";
import { validateAndRepairFrookyConfig } from "./shared/configValidator";
import { CrashReport, installCrashReporter } from "./shared/crashReporter";
import { DEFAULT_SETTING_LOG_LEVEL, DEFAULT_SETTING_LOG_TO, PROGRESS_INTERVAL_MS } from "./shared/defaultValues";
import { BaseEvent } from "./shared/event/baseEvent";
import { startEventSender } from "./shared/event/eventSender";
import { HookEvent } from "./shared/event/hookEvent";
import { LogEvent } from "./shared/event/logEvent";
import { InputFrookyConfig } from "./shared/frookyConfig";
import { Platform } from "./shared/frookyMetadata";
import { FrookySettings } from "./shared/frookySettings";
import { diffConfig, HookToResolve } from "./shared/hook/configDiff";
import { Hook } from "./shared/hook/hook";
import {
  configLabel,
  describeConfig,
  describeInputHook,
  describeLoad,
  describeLookup,
  HookProgress,
  HookStatistic,
  LoadSummary,
} from "./shared/hook/hookDescriptions";
import { HookManager, isWaiting, Resolution } from "./shared/hook/hookManager";
import { HookRegistry } from "./shared/hook/hookRegistry";
import { HookValidator } from "./shared/hook/hookValidator";
import { logger, LogLevel, LogTo } from "./shared/logger";
import { PlatformStackTrace } from "./shared/platformStackTrace";
import { plural } from "./shared/utils";

// Loads hook configs, installs their hooks and collects the events.
export class FrookyAgent {
  private eventCache: BaseEvent[] = [];
  private platform: Platform;
  private platformHookValidator: HookValidator<any, any>;
  private platformHookManger: HookManager<any, any, any>;
  private nativeHookValidator = new NativeHookValidator();
  private nativeHookManager: NativeHookManager;
  private readonly registry = new HookRegistry();
  private reportProgress?: (progress: HookProgress) => void;
  public readonly targetReady: Promise<void>; // resolves once the target's own code can be looked up (e.g. Java.perform())
  public isTargetReady = false;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    platform: Platform,
    platformInputHookValidator: HookValidator<any, any>,
    createPlatformHookManager: (frookyAgent: FrookyAgent) => HookManager<any, any, any>,
    platformStackTrace: PlatformStackTrace,
    logLevel: LogLevel = DEFAULT_SETTING_LOG_LEVEL,
    logTo: LogTo = DEFAULT_SETTING_LOG_TO,
    reportProgress?: (progress: HookProgress) => void,
    targetReady: Promise<void> = Promise.resolve(),
  ) {
    if (Process.pointerSize !== 8) {
      throw new Error(
        `[!] frooky supports only 64-bit processes (arm64, x86_64), but this process is ${Process.arch} (${Process.pointerSize * 8}-bit). An app that ships only 32-bit native libraries runs as a 32-bit process.`,
      );
    }
    logger.setAgent(this);
    logger.setVerbosity(logLevel);
    logger.setLogTo(logTo);
    logger.info(`Agent init: ${platform} (${Process.platform}/${Process.arch}), pid ${Process.id}, Frida ${Frida.version}`);
    logger.debug(`Target process:\n${JSON.stringify(Process, null, 2)}`);

    startEventSender(this.eventCache);

    this.platform = platform;
    this.platformHookValidator = platformInputHookValidator;
    this.reportProgress = reportProgress;
    this.targetReady = targetReady;
    void targetReady.then(() => {
      this.isTargetReady = true;
      platformStackTrace.prepare?.();
      markTargetReady();
      logger.info("targetReady: the app's classes can be looked up, installing the hooks that waited for it");
    });
    watchLinker();
    this.nativeHookManager = new NativeHookManager(platformStackTrace, this);
    this.platformHookManger = createPlatformHookManager(this);
  }

  // Sends a CrashReport when the process is about to die from a native exception, see installCrashReporter().
  public reportCrashes(report: (crash: CrashReport) => void): void {
    installCrashReporter(this.nativeHookManager.hookIndex, report);
  }

  // Loads configs concurrently. `configIds` are index-aligned with `inputFrookyConfigs`, see loadFrookyConfig().
  // Resolves once the configs are parsed and every hook that needs no event (targetReady, or a class or module that
  // loads) is resolved and installed: in spawn mode, the host resumes the app then. The other hooks keep resolving,
  // and the summary of a config is logged once its hooks are installed, not found or waiting.
  public loadFrookyConfigs(inputFrookyConfigs: InputFrookyConfig[], configIds?: string[]): Promise<void> {
    const initializing: Promise<void>[] = [];
    const loaded = Promise.all(
      inputFrookyConfigs.map((inputFrookyConfig, i) =>
        this.applyFrookyConfig(inputFrookyConfig, configIds?.[i], false, initializing)
          .then((summary) => {
            if (summary) logger.info(`Loaded ${describeConfig(inputFrookyConfig, configIds?.[i])}: ${describeLoad(summary)}`);
          })
          .catch((e) => {
            logger.error(`Error during loading of the frooky config: ${String(e)}`);
          }),
      ),
    );
    // also when no config was valid, so the host stops waiting for a report
    void loaded.then(() => this.scheduleProgressReport());
    return Promise.all(initializing).then(() => undefined);
  }

  // Loads a config and logs what changed, e.g. `Updated hooks.yaml: 1 new, 3 unchanged; hooked 2 methods`.
  // A config with a known `configId` (the host uses the hook file path) replaces the previous version
  // incrementally: unchanged hooks stay installed, removed ones are unhooked, new and changed ones are resolved.
  // Declarations that were not found are retried if `retryNotFound` is set or their declaration changed. An invalid config keeps the
  // previous version. The diff runs before the first `await`, so consecutive calls apply in order.
  public async loadFrookyConfig(inputFrookyConfig: InputFrookyConfig, configId?: string, retryNotFound = false) {
    const isReload = configId !== undefined && this.registry.has(configId);
    const summary = await this.applyFrookyConfig(inputFrookyConfig, configId, retryNotFound);
    this.scheduleProgressReport();
    if (!summary) return;
    const verb = !isReload ? "Loaded" : retryNotFound ? "Reloaded" : "Updated";
    logger.info(`${verb} ${describeConfig(inputFrookyConfig, configId)}: ${describeLoad(summary)}`);
  }

  // loadFrookyConfig() without the summary log. Returns `undefined` if the config is invalid. Adds a promise per hook
  // manager to `initializing`, see resolveAndRegisterHooks().
  private async applyFrookyConfig(
    inputFrookyConfig: InputFrookyConfig,
    configId?: string,
    retryNotFound = false,
    initializing?: Promise<void>[],
  ): Promise<LoadSummary | undefined> {
    const label = describeConfig(inputFrookyConfig, configId);
    logger.debug(`Parsing ${label}`);

    let validFrookyConfig: InputFrookyConfig;
    try {
      validFrookyConfig = validateAndRepairFrookyConfig(inputFrookyConfig, this.platform);
    } catch (e) {
      if (configId !== undefined && this.registry.has(configId)) {
        logger.warn(`Not reloaded ${configLabel(configId)}, keeping the previous version: ${e}`);
      } else {
        logger.warn(`Skipping frooky config: ${e}`);
      }
      return undefined;
    }

    const validatedFrookySettings = validFrookyConfig.settings as FrookySettings;

    logger.debug(`Validating '${this.platform}' hooks`);
    const validPlatformHooks = this.platformHookValidator.validateAndNormalizeHooks(inputFrookyConfig, validatedFrookySettings);

    logger.debug(`Validating 'native' hooks`);
    const validNativeHook = this.nativeHookValidator.validateAndNormalizeHooks(inputFrookyConfig, validatedFrookySettings);

    const id = this.registry.idOf(configId);
    const { entries, platformToResolve, nativeToResolve, removedEntries, ...counts } = diffConfig(
      this.registry.get(id),
      validPlatformHooks,
      validNativeHook,
      retryNotFound,
    );
    for (const { entry } of [...platformToResolve, ...nativeToResolve]) entry.state = "resolving";
    // resolving and waiting hooks of removed declarations are dropped once they resolve
    for (const { fingerprint, entry } of removedEntries) {
      if (entry.state === "installed" && entry.hooks) {
        const manager = fingerprint.startsWith("native:") ? this.nativeHookManager : this.platformHookManger;
        manager.unregisterHooks(entry.hooks);
      }
      entry.state = "removed";
    }
    this.registry.set(id, entries);

    logger.info(
      `Parsed ${label}: ${plural(validPlatformHooks.length, `${this.platform} hook`)} and ${plural(validNativeHook.length, "native hook")}, ${platformToResolve.length + nativeToResolve.length} to resolve`,
    );
    this.scheduleProgressReport();

    // resolve and install the new, changed and retried hooks
    const [countSuccessfulPlatformHooks, countSuccessfulNativeHooks] = await Promise.all([
      this.resolveAndRegisterHooks(this.platformHookManger, platformToResolve, "platform", label, initializing),
      this.resolveAndRegisterHooks(this.nativeHookManager, nativeToResolve, "native", label, initializing),
    ]);

    const toResolve = [...platformToResolve, ...nativeToResolve];
    return {
      ...counts,
      hookedMethods: countSuccessfulPlatformHooks,
      hookedFunctions: countSuccessfulNativeHooks,
      waiting: toResolve.filter(({ entry }) => entry.state === "waiting").length,
      notFound: toResolve.filter(({ entry }) => entry.state === "notFound").length,
    };
  }

  // Resolves and installs hooks and returns how many were installed once each hook is installed, not found, or waiting
  // for its class or module after the lookups at targetReady. A waiting hook is installed whenever that loads. A hook
  // whose entry was removed while it resolved (the config was reloaded) is not installed, or unhooked again. `source`
  // names the hook file in log messages. Adds a promise to `initializing`, before the first `await`, that resolves once
  // the hooks the first lookup decided are installed or not found.
  private async resolveAndRegisterHooks(
    manager: HookManager<any, any, any>,
    hooksToResolve: HookToResolve[],
    kind: string,
    source: string,
    initializing?: Promise<void>[],
  ): Promise<number> {
    if (hooksToResolve.length === 0) return 0;
    let markInitialized: () => void = () => {};
    initializing?.push(new Promise<void>((resolve) => (markInitialized = resolve)));

    let resolutions: Resolution<Hook[] | null>[];
    try {
      resolutions = await manager.resolveHooks(
        hooksToResolve.map((hookToResolve) => hookToResolve.inputHook),
        source,
      );
    } catch (e) {
      for (const { entry } of hooksToResolve) {
        if (entry.state === "resolving") entry.state = "notFound";
      }
      this.scheduleProgressReport();
      logger.error(`Error while resolving ${kind} hooks of ${source}: ${String(e)}`);
      markInitialized();
      return 0;
    }

    let countSuccessfulHooks = 0;
    const install = ({ entry }: HookToResolve, hooks: Hook[] | null) => {
      if (entry.state === "removed") {
        // hooks are installed while their class or module loads, see HookManager.resolveHooks()
        if (hooks) manager.unregisterHooks(hooks);
        return;
      }
      this.scheduleProgressReport();
      if (!hooks) {
        entry.state = "notFound";
        return;
      }
      const hookedCount = manager.registerHooks(hooks, source);
      countSuccessfulHooks += hookedCount;
      entry.hooks = hooks;
      entry.hookedCount = hookedCount;
      entry.state = "installed";
    };
    const reject = ({ inputHook, entry }: HookToResolve, reason: unknown) => {
      if (entry.state !== "resolving" && entry.state !== "waiting") return;
      entry.state = "notFound";
      logger.warn(`Failed to hook ${describeInputHook(inputHook)} (${source}): ${reason instanceof Error ? reason.message : String(reason)}`);
      this.scheduleProgressReport();
    };

    // installs what the first lookup decided right away, the rest once the lookups at targetReady have run; resolves
    // with the hooks that still wait for their class or module then
    const lookedUp = resolutions.map((resolution, i): HookToResolve | undefined | Promise<HookToResolve | undefined> => {
      const hookToResolve = hooksToResolve[i];
      if (!(resolution instanceof Promise)) {
        install(hookToResolve, resolution as Hook[] | null);
        return undefined;
      }
      return resolution.then(
        (result) => {
          if (!isWaiting(result)) {
            install(hookToResolve, result);
            return undefined;
          }
          void result.waiting.then(
            (hooks) => install(hookToResolve, hooks),
            (reason) => reject(hookToResolve, reason),
          );
          return hookToResolve;
        },
        (reason) => {
          reject(hookToResolve, reason);
          return undefined;
        },
      );
    });
    markInitialized();
    this.reportWaiting((await Promise.all(lookedUp)).filter((hookToResolve) => hookToResolve !== undefined));
    return countSuccessfulHooks;
  }

  // Marks the hooks that are still resolving as waiting, and logs once per class or module they wait for
  private reportWaiting(hooksToResolve: HookToResolve[]): void {
    const waiting = hooksToResolve.filter(({ entry }) => entry.state === "resolving");
    if (waiting.length === 0) return;
    const lookups = new Set<string>();
    for (const { inputHook, entry } of waiting) {
      entry.state = "waiting";
      lookups.add(describeLookup(inputHook));
    }
    for (const lookup of lookups) {
      logger.info(`${lookup} isn't loaded yet. Its hooks are installed when it loads.`);
    }
    this.scheduleProgressReport();
  }

  // HookProgress across all loaded configs
  public hookProgress(): HookProgress {
    return this.registry.progress();
  }

  // Reports HookProgress to the host at most once per PROGRESS_INTERVAL_MS. The progress is read when the
  // report is sent, so it is always current.
  private scheduleProgressReport(): void {
    const reportProgress = this.reportProgress;
    if (!reportProgress || this.progressTimer !== null) return;
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null;
      reportProgress(this.hookProgress());
    }, PROGRESS_INTERVAL_MS);
  }

  // `hook` is the hook that recorded `event` and `decodeMs` the time it spent decoding its values, both for
  // hookStatistics()
  public addEventToLog(event: LogEvent | HookEvent, hook?: Hook, decodeMs: number = 0): void {
    this.eventCache.push(event);
    if (hook) this.registry.countEvent(hook, decodeMs);
  }

  // Every hook declaration of the loaded configs, see HookStatistic
  public hookStatistics(): HookStatistic[] {
    return this.registry.statistics();
  }
}
