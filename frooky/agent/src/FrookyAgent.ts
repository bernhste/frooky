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

/** The file name of a config id, which the host sets to the hook file path. */
function configLabel(configId: string): string {
  return configId.split(/[\\/]/).pop() || configId;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Summarizes a reload in hook declarations, e.g. `1 added (2 methods hooked), 1 removed, 3 unchanged`.
 * The counts in parentheses are resolved hooks (one per overload or function) of the added declarations.
 */
export function describeReload(
  added: number,
  hookedMethods: number,
  hookedFunctions: number,
  failed: number,
  removed: number,
  unchanged: number,
): string {
  if (added === 0 && removed === 0) return "no changes";
  const parts: string[] = [];
  if (added > 0) {
    const details: string[] = [];
    if (hookedMethods > 0) details.push(`${plural(hookedMethods, "method")} hooked`);
    if (hookedFunctions > 0) details.push(`${plural(hookedFunctions, "function")} hooked`);
    if (failed > 0) details.push(`${failed} failed`);
    parts.push(`${added} added (${details.length > 0 ? details.join(", ") : "nothing hooked"})`);
  }
  if (removed > 0) parts.push(`${removed} removed`);
  if (unchanged > 0) parts.push(`${unchanged} unchanged`);
  return parts.join(", ");
}

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
   * resolved and installed. Hooks that failed to resolve are not retried unless their declaration changes.
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
      if (configId !== undefined && this.loadedConfigs.has(configId)) {
        console.log(`  Not reloaded ${configLabel(configId)}, keeping the previous version: ${e}`);
      } else {
        logger.warn(`Skipping frooky config: ${e}`);
      }
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
        if (previousEntry) {
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
      }
      previousEntry.state = "removed";
      countRemoved++;
    }
    this.loadedConfigs.set(id, entries);

    const configName = inputFrookyConfig.metadata?.name;
    const nameSuffix = configName ? ` '${configName}'` : "";
    const hookSuffix = configName ? ` from frooky configuration '${configName}'` : "";

    logger.info(`Frooky configuration${nameSuffix} successfully parsed`);

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

    // printed unconditionally (bypassing the logger's own verbosity setting): the user sees what a
    // reload did, and external tooling detects when the initial load is done resolving.
    if (previousEntries) {
      const countAdded = platformToResolve.length + nativeToResolve.length;
      const countFailed = [...platformToResolve, ...nativeToResolve].filter(({ entry }) => entry.state === "failed").length;
      console.log(
        `  Reloaded ${configLabel(id)}: ${describeReload(countAdded, countSuccessfulPlatformHooks, countSuccessfulNativeHooks, countFailed, countRemoved, countUnchanged)}`,
      );
    } else {
      console.log(`Resolved Hooks: ${countSuccessfulPlatformHooks + countSuccessfulNativeHooks}`);
    }
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
