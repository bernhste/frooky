import { NativeHookManager } from "./native/hook/nativeHookManager";
import { NativeHookValidator } from "./native/hook/nativeHookValidator";
import { validateAndRepairFrookyConfig } from "./shared/configValidator";
import { DEFAULT_SETTING_LOG_LEVEL, DEFAULT_SETTING_LOG_TO, DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS } from "./shared/defaultValues";
import { BaseEvent } from "./shared/event/baseEvent";
import { startEventSender } from "./shared/event/eventSender";
import { HookEvent } from "./shared/event/hookEvent";
import { LogEvent } from "./shared/event/logEvent";
import { InputFrookyConfig } from "./shared/frookyConfig";
import { Platform } from "./shared/frookyMetadata";
import { FrookySettings } from "./shared/frookySettings";
import { Hook } from "./shared/hook/hook";
import { HookManager } from "./shared/hook/hookManager";
import { HookValidator } from "./shared/hook/hookValidator";
import { logger, LogLevel, LogTo } from "./shared/logger";
import { PlatformStackTrace } from "./shared/platformStackTrace";
import { stableStringify } from "./shared/utils";

/**
 * State of one normalized hook declaration of a loaded config.
 * `hooks` are the resolved hooks (one per overload or function), set once installed.
 */
type LoadedHookEntry = {
  state: "pending" | "installed" | "failed" | "removed";
  hooks?: Hook[];
};

type PendingHook = { inputHook: unknown; entry: LoadedHookEntry };

/**
 * Main application class for Frooky.
 * Manages configuration, events, and lifecycle of a frooky session.
 */
export class FrookyAgent {
  private eventCache: BaseEvent[] = [];
  private platform: Platform;
  private platformHookValidator: HookValidator<any, any>;
  private platformHookManger: HookManager<any, any, any>;
  private nativeHookValidator = new NativeHookValidator();
  private nativeHookManager: NativeHookManager;
  private resolverTimeoutSeconds: number;
  // hooks of every loaded config, keyed by config id and then by the fingerprint of the normalized hook
  private loadedConfigs = new Map<string, Map<string, LoadedHookEntry>>();
  private anonymousConfigCount = 0;

  constructor(
    platform: Platform,
    platformInputHookValidator: HookValidator<any, any>,
    createPlatformHookManager: (frookyAgent: FrookyAgent) => HookManager<any, any, any>,
    platformStackTrace: PlatformStackTrace,
    logLevel: LogLevel = DEFAULT_SETTING_LOG_LEVEL,
    logTo: LogTo = DEFAULT_SETTING_LOG_TO,
    resolverTimeoutSeconds: number = DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
  ) {
    //initialize asynchronous sender
    startEventSender(this.eventCache);

    this.platform = platform;
    this.platformHookValidator = platformInputHookValidator;
    this.resolverTimeoutSeconds = resolverTimeoutSeconds;
    this.nativeHookManager = new NativeHookManager(platformStackTrace, this);
    this.platformHookManger = createPlatformHookManager(this);

    // setup logger
    logger.setAgent(this);
    logger.setVerbosity(logLevel);
    logger.setLogTo(logTo);
    logger.info("Logger initialized");

    // printing some context infos
    logger.info("Initializing frooky");
    logger.info(`Declared target platform: ${this.platform}`);
    logger.info(`Target platform: ${Process.platform}`);
    logger.info(`Target frida version: ${Frida.version}`);
    logger.info(`Target arch: ${Process.arch}`);
    logger.debug(`Target process:\n${JSON.stringify(Process, null, 2)}}`);
  }

  /**
   * Loads hook configs, resolves their hooks and runs them. All configs are applied immediately and
   * resolve concurrently, so a later {@link loadFrookyConfig} call for the same id always wins.
   *
   * @param inputFrookyConfigs - The frooky configs to add.
   * @param configIds - Optional ids, index-aligned with `inputFrookyConfigs`, see {@link loadFrookyConfig}.
   */
  public async loadFrookyConfigs(inputFrookyConfigs: InputFrookyConfig[], configIds?: string[]) {
    await Promise.all(
      inputFrookyConfigs.map((inputFrookyConfig, i) =>
        this.loadFrookyConfig(inputFrookyConfig, configIds?.[i]).catch((e) => {
          logger.error(`Error during loading of the frooky config: ${String(e)}`);
        }),
      ),
    );
  }

  /**
   * Validates a {@link InputFrookyConfig} and installs its hooks.
   *
   * If a config with the same `configId` was loaded before, the new config replaces it
   * incrementally: hooks whose normalized declaration is unchanged are left untouched (no class,
   * module or symbol lookup), hooks that are gone are removed, and only new or changed hooks are
   * resolved and installed. Hooks of the previous version that failed to resolve are retried.
   * An invalid config is rejected and leaves the previously loaded version in place.
   *
   * The diff happens synchronously before the first `await`, so consecutive calls apply in order.
   *
   * @param inputFrookyConfig - The configuration to add.
   * @param configId - Identifies the config across reloads (the host uses the hook file path).
   *   Without an id, the config is always added as a new one.
   */
  public async loadFrookyConfig(inputFrookyConfig: InputFrookyConfig, configId?: string) {
    logger.debug("Loading frooky configuration.");

    // validate frooky config
    logger.debug("Validating frooky configuration");
    let validFrookyConfig: InputFrookyConfig;
    try {
      validFrookyConfig = validateAndRepairFrookyConfig(inputFrookyConfig, this.platform);
    } catch (e) {
      logger.warn(`Skipping frooky config: ${e}`);
      return;
    }

    const validatedFrookySettings = validFrookyConfig.settings as FrookySettings;

    // validate the platform hooks
    logger.debug(`Validating '${this.platform}' hooks`);
    const validPlatformHooks = this.platformHookValidator.validateAndNormalizeHooks(inputFrookyConfig, validatedFrookySettings);

    logger.debug(`Validating 'native' hooks`);
    const validNativeHook = this.nativeHookValidator.validateAndNormalizeHooks(inputFrookyConfig, validatedFrookySettings);

    // diff against the previously loaded version of this config
    const id = configId ?? `#${++this.anonymousConfigCount}`;
    const previousEntries = this.loadedConfigs.get(id);
    const entries = new Map<string, LoadedHookEntry>();
    const platformToResolve: PendingHook[] = [];
    const nativeToResolve: PendingHook[] = [];
    let countUnchanged = 0;

    const diff = (kind: string, inputHooks: unknown[], toResolve: PendingHook[]) => {
      for (const inputHook of inputHooks) {
        const fingerprint = `${kind}:${stableStringify(inputHook)}`;
        if (entries.has(fingerprint)) {
          logger.debug(`Skipping duplicate hook declaration: ${fingerprint}`);
          continue;
        }
        const previousEntry = previousEntries?.get(fingerprint);
        if (previousEntry && previousEntry.state !== "failed") {
          entries.set(fingerprint, previousEntry);
          countUnchanged++;
          continue;
        }
        const entry: LoadedHookEntry = { state: "pending" };
        entries.set(fingerprint, entry);
        toResolve.push({ inputHook, entry });
      }
    };
    diff("platform", validPlatformHooks, platformToResolve);
    diff("native", validNativeHook, nativeToResolve);

    // remove hooks that are no longer declared; pending ones are dropped once they resolve
    let countRemoved = 0;
    for (const [fingerprint, previousEntry] of previousEntries ?? []) {
      if (entries.get(fingerprint) === previousEntry) continue;
      if (previousEntry.state === "installed" && previousEntry.hooks) {
        const manager = fingerprint.startsWith("native:") ? this.nativeHookManager : this.platformHookManger;
        manager.unregisterHooks(previousEntry.hooks);
        countRemoved += previousEntry.hooks.length;
      }
      previousEntry.state = "removed";
    }
    this.loadedConfigs.set(id, entries);

    const configName = inputFrookyConfig.metadata?.name;
    const nameSuffix = configName ? ` '${configName}'` : "";
    const hookSuffix = configName ? ` from frooky configuration '${configName}'` : "";

    logger.info(`Frooky configuration${nameSuffix} successfully parsed`);
    if (previousEntries) {
      // printed unconditionally, like 'Resolved Hooks' below, so the user sees what a reload did
      console.log(
        `Updating frooky configuration${nameSuffix}: ${platformToResolve.length + nativeToResolve.length} new or changed, ` +
          `${countUnchanged} unchanged, ${countRemoved} hooks removed`,
      );
    }

    // async resolve the new hooks and register them
    const [countSuccessfulPlatformHooks, countSuccessfulNativeHooks] = await Promise.all([
      this.resolveAndRegisterHooks(this.platformHookManger, platformToResolve, "platform").then((count) => {
        if (count > 0) logger.info(`Successfully hooked ${count} ${this.platform} methods${hookSuffix}`);
        return count;
      }),
      this.resolveAndRegisterHooks(this.nativeHookManager, nativeToResolve, "native").then((count) => {
        if (count > 0) logger.info(`Successfully hooked ${count} native functions${hookSuffix}`);
        return count;
      }),
    ]);

    // printed unconditionally (bypassing the logger's own verbosity setting) so external tooling
    // can detect when this config is done resolving, independent of -v/-vv.
    console.log(`Resolved Hooks: ${countSuccessfulPlatformHooks + countSuccessfulNativeHooks}`);
  }

  /**
   * Resolves and installs the given hooks, and records the result on each hook's entry.
   * A hook whose entry was removed while it was resolving (the config was reloaded meanwhile) is not installed.
   *
   * @returns The number of installed hooks.
   */
  private async resolveAndRegisterHooks(manager: HookManager<any, any, any>, pendingHooks: PendingHook[], label: string): Promise<number> {
    if (pendingHooks.length === 0) return 0;

    let countSuccessfulHooks = 0;
    try {
      const hookPromises = await manager.resolveHooks(
        pendingHooks.map((pendingHook) => pendingHook.inputHook),
        this.resolverTimeoutSeconds,
      );
      await Promise.allSettled(
        hookPromises.map((hookPromise, i) =>
          hookPromise.then((hooks) => {
            const entry = pendingHooks[i]?.entry;
            if (!entry || entry.state === "removed") return;
            if (!hooks) {
              entry.state = "failed";
              return;
            }
            countSuccessfulHooks += manager.registerHooks(hooks);
            entry.hooks = hooks;
            entry.state = "installed";
          }),
        ),
      );
    } catch (e) {
      for (const { entry } of pendingHooks) {
        if (entry.state === "pending") entry.state = "failed";
      }
      logger.error(`Error while resolving ${label} hooks: ${String(e)}`);
    }
    return countSuccessfulHooks;
  }

  /**
   * Adds an event to the internal event cache.
   *
   * @param event - The event to cache.
   */
  public addEventToLog(event: LogEvent | HookEvent): void {
    this.eventCache.push(event);
  }
}
