import { NativeHookManager } from "./native/hook/nativeHookManager";
import { NativeHookValidator } from "./native/hook/nativeHookValidator";
import { validateAndRepairFrookyConfig } from "./shared/configValidator";
import {
  DEFAULT_SETTING_LOG_LEVEL,
  DEFAULT_SETTING_LOG_TO,
  DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
  PROGRESS_INTERVAL_MS,
} from "./shared/defaultValues";
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
 * `target` is the hooked class method or module symbol and `lookup` the class or module it waits
 * for, if known; `hooks` are the resolved hooks (one per overload or function) and `hookedCount`
 * how many of them were installed, set once installed.
 */
type LoadedHookEntry = {
  state: "pending" | "installed" | "failed" | "removed";
  target?: string;
  lookup?: string;
  hooks?: Hook[];
  hookedCount?: number;
};

type PendingHook = { inputHook: unknown; entry: LoadedHookEntry };

/** The file name of a config id, which the host sets to the hook file path. */
function configLabel(configId: string): string {
  return configId.split(/[\\/]/).pop() || configId;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The class or module a normalized hook declaration waits for until it can be resolved. */
function lookupOf(kind: string, inputHook: unknown): string | undefined {
  if (typeof inputHook !== "object" || inputHook === null) return undefined;
  const hook = inputHook as { javaClass?: string; module?: string };
  const lookup = hook.javaClass ?? hook.module;
  return lookup ? `${kind}:${lookup}` : undefined;
}

/** A normalized hook declaration for log messages, e.g. `com.example.Foo.bar` or `libfoo.so!open`. */
function describeInputHook(inputHook: unknown): string {
  const target = targetOf("", inputHook);
  return target ? target.slice(1) : JSON.stringify(inputHook);
}

/**
 * The class method or module symbol a normalized hook declaration targets. A declaration whose other
 * properties (overloads, settings, ...) changed keeps its target, so a reload reports it as updated.
 */
function targetOf(kind: string, inputHook: unknown): string | undefined {
  if (typeof inputHook !== "object" || inputHook === null) return undefined;
  const hook = inputHook as { javaClass?: string; method?: string; module?: string; symbol?: string };
  if (hook.javaClass && hook.method) return `${kind}:${hook.javaClass}.${hook.method}`;
  if (hook.module && hook.symbol) return `${kind}:${hook.module}!${hook.symbol}`;
  return undefined;
}

/**
 * Live state of hook resolving across all loaded configs, reported to the host while hooks resolve:
 * `hooked` counts installed hooks (one per overload or function), `pending` the classes and modules
 * that are still being looked up.
 */
export type HookProgress = { hooked: number; pending: number };

/** What resolving hooks did: installed hooks (one per overload or function) and the declarations that failed to resolve. */
export type HookedSummary = {
  hookedMethods: number;
  hookedFunctions: number;
  failed: number;
};

/** What loading a config did, counted in hook declarations except for the {@link HookedSummary} counts. */
export type LoadSummary = HookedSummary & {
  added: number;
  updated: number;
  removed: number;
  retried: number;
  unchanged: number;
};

/** Describes what resolving hooks did, e.g. `hooked 2 methods and 1 function, 3 not resolved`. */
export function describeHooked({ hookedMethods, hookedFunctions, failed }: HookedSummary): string {
  const hooked: string[] = [];
  if (hookedMethods > 0) hooked.push(plural(hookedMethods, "method"));
  if (hookedFunctions > 0) hooked.push(plural(hookedFunctions, "function"));
  const text = hooked.length > 0 ? `hooked ${hooked.join(" and ")}` : "hooked nothing";
  return failed > 0 ? `${text}, ${failed} not resolved` : text;
}

/**
 * Summarizes a reload, e.g. `1 new, 1 updated, 1 removed, 3 unchanged; hooked 2 methods`.
 * The part after the semicolon lists what the new, updated and retried declarations resolved to.
 */
export function describeLoad(summary: LoadSummary): string {
  const { added, updated, removed, retried, unchanged } = summary;
  const changes: string[] = [];
  if (added > 0) changes.push(`${added} new`);
  if (updated > 0) changes.push(`${updated} updated`);
  if (removed > 0) changes.push(`${removed} removed`);
  if (retried > 0) changes.push(`${retried} retried`);
  if (changes.length === 0) return "no changes";
  if (unchanged > 0) changes.push(`${unchanged} unchanged`);
  const text = changes.join(", ");
  return added + updated + retried > 0 ? `${text}; ${describeHooked(summary)}` : text;
}

/** The message logged once the hook files given at startup are resolved, e.g. `Hooks ready: 38 hooked (30 methods, 8 functions), 4 not resolved`. */
export function describeReady({ hookedMethods, hookedFunctions, failed }: HookedSummary): string {
  const kinds: string[] = [];
  if (hookedMethods > 0) kinds.push(plural(hookedMethods, "method"));
  if (hookedFunctions > 0) kinds.push(plural(hookedFunctions, "function"));
  const text = `Hooks ready: ${hookedMethods + hookedFunctions} hooked${kinds.length > 0 ? ` (${kinds.join(", ")})` : ""}`;
  return failed > 0 ? `${text}, ${failed} not resolved` : text;
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
  private reportProgress?: (progress: HookProgress) => void;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    platform: Platform,
    platformInputHookValidator: HookValidator<any, any>,
    createPlatformHookManager: (frookyAgent: FrookyAgent) => HookManager<any, any, any>,
    platformStackTrace: PlatformStackTrace,
    logLevel: LogLevel = DEFAULT_SETTING_LOG_LEVEL,
    logTo: LogTo = DEFAULT_SETTING_LOG_TO,
    resolverTimeoutSeconds: number = DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
    reportProgress?: (progress: HookProgress) => void,
  ) {
    //initialize asynchronous sender
    startEventSender(this.eventCache);

    this.platform = platform;
    this.platformHookValidator = platformInputHookValidator;
    this.resolverTimeoutSeconds = resolverTimeoutSeconds;
    this.reportProgress = reportProgress;
    this.nativeHookManager = new NativeHookManager(platformStackTrace, this);
    this.platformHookManger = createPlatformHookManager(this);

    // setup logger
    logger.setAgent(this);
    logger.setVerbosity(logLevel);
    logger.setLogTo(logTo);
    logger.debug("Logger initialized");

    // printing some context infos
    logger.debug("Initializing frooky");
    logger.debug(`Declared target platform: ${this.platform}`);
    logger.debug(`Target platform: ${Process.platform}`);
    logger.debug(`Target frida version: ${Frida.version}`);
    logger.debug(`Target arch: ${Process.arch}`);
    logger.debug(`Target process:\n${JSON.stringify(Process, null, 2)}}`);
  }

  /**
   * Loads hook configs, resolves their hooks and runs them. All configs are applied immediately and
   * resolve concurrently, so a later {@link loadFrookyConfig} call for the same id always wins.
   * Once all are resolved, logs one `Hooks ready: ...` summary for all configs; the host and its
   * integration tests wait for it.
   *
   * @param inputFrookyConfigs - The frooky configs to add.
   * @param configIds - Optional ids, index-aligned with `inputFrookyConfigs`, see {@link loadFrookyConfig}.
   */
  public async loadFrookyConfigs(inputFrookyConfigs: InputFrookyConfig[], configIds?: string[]) {
    const summaries = await Promise.all(
      inputFrookyConfigs.map((inputFrookyConfig, i) =>
        this.applyFrookyConfig(inputFrookyConfig, configIds?.[i]).catch((e) => {
          logger.error(`Error during loading of the frooky config: ${String(e)}`);
          return undefined;
        }),
      ),
    );
    const total: HookedSummary = { hookedMethods: 0, hookedFunctions: 0, failed: 0 };
    for (const summary of summaries) {
      if (!summary) continue;
      total.hookedMethods += summary.hookedMethods;
      total.hookedFunctions += summary.hookedFunctions;
      total.failed += summary.failed;
    }
    logger.info(describeReady(total));
    // also when no config was valid, so the host stops waiting for a report
    this.scheduleProgressReport();
  }

  /**
   * Validates a {@link InputFrookyConfig}, installs its hooks and logs a summary of what changed,
   * e.g. `Updated hooks.yaml: 1 new, 3 unchanged; hooked 2 methods`.
   *
   * If a config with the same `configId` was loaded before, the new config replaces it
   * incrementally: hooks whose normalized declaration is unchanged are left untouched (no class,
   * module or symbol lookup), hooks that are gone are removed, and only new or changed hooks are
   * resolved and installed. Hooks that failed to resolve are only retried if `retryFailed` is set
   * or their declaration changed.
   * An invalid config is rejected and leaves the previously loaded version in place.
   *
   * The diff happens synchronously before the first `await`, so consecutive calls apply in order.
   *
   * @param inputFrookyConfig - The configuration to add.
   * @param configId - Identifies the config across reloads (the host uses the hook file path).
   *   Without an id, the config is always added as a new one.
   * @param retryFailed - Also resolve unchanged hooks that failed to resolve in the previous version.
   */
  public async loadFrookyConfig(inputFrookyConfig: InputFrookyConfig, configId?: string, retryFailed = false) {
    const isReload = configId !== undefined && this.loadedConfigs.has(configId);
    const summary = await this.applyFrookyConfig(inputFrookyConfig, configId, retryFailed);
    this.scheduleProgressReport();
    if (!summary) return;
    const verb = !isReload ? "Loaded" : retryFailed ? "Reloaded" : "Updated";
    const label = configId !== undefined ? configLabel(configId) : (inputFrookyConfig.metadata?.name ?? "frooky config");
    logger.info(`${verb} ${label}: ${describeLoad(summary)}`);
  }

  /**
   * Applies a config as described in {@link loadFrookyConfig}, without logging a summary.
   *
   * @returns What changed, or `undefined` if the config was invalid.
   */
  private async applyFrookyConfig(inputFrookyConfig: InputFrookyConfig, configId?: string, retryFailed = false): Promise<LoadSummary | undefined> {
    logger.debug("Loading frooky configuration.");

    // validate frooky config
    logger.debug("Validating frooky configuration");
    let validFrookyConfig: InputFrookyConfig;
    try {
      validFrookyConfig = validateAndRepairFrookyConfig(inputFrookyConfig, this.platform);
    } catch (e) {
      if (configId !== undefined && this.loadedConfigs.has(configId)) {
        logger.warn(`Not reloaded ${configLabel(configId)}, keeping the previous version: ${e}`);
      } else {
        logger.warn(`Skipping frooky config: ${e}`);
      }
      return undefined;
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
    const addedEntries: LoadedHookEntry[] = [];
    let countUnchanged = 0;
    let countRetried = 0;

    const diff = (kind: string, inputHooks: unknown[], toResolve: PendingHook[]) => {
      for (const inputHook of inputHooks) {
        const fingerprint = `${kind}:${stableStringify(inputHook)}`;
        if (entries.has(fingerprint)) {
          logger.debug(`Skipping duplicate hook declaration: ${fingerprint}`);
          continue;
        }
        const previousEntry = previousEntries?.get(fingerprint);
        if (previousEntry && !(retryFailed && previousEntry.state === "failed")) {
          entries.set(fingerprint, previousEntry);
          countUnchanged++;
          continue;
        }
        // a retried hook keeps its entry, so it is not counted as removed below
        const entry: LoadedHookEntry = previousEntry ?? { state: "pending", target: targetOf(kind, inputHook), lookup: lookupOf(kind, inputHook) };
        if (previousEntry) {
          previousEntry.state = "pending";
          countRetried++;
        } else {
          addedEntries.push(entry);
        }
        entries.set(fingerprint, entry);
        toResolve.push({ inputHook, entry });
      }
    };
    diff("platform", validPlatformHooks, platformToResolve);
    diff("native", validNativeHook, nativeToResolve);

    // remove hooks that are no longer declared; pending ones are dropped once they resolve
    const removedTargets = new Map<string, number>();
    let countRemoved = 0;
    for (const [fingerprint, previousEntry] of previousEntries ?? []) {
      if (entries.get(fingerprint) === previousEntry) continue;
      if (previousEntry.state === "installed" && previousEntry.hooks) {
        const manager = fingerprint.startsWith("native:") ? this.nativeHookManager : this.platformHookManger;
        manager.unregisterHooks(previousEntry.hooks);
      }
      previousEntry.state = "removed";
      countRemoved++;
      if (previousEntry.target) removedTargets.set(previousEntry.target, (removedTargets.get(previousEntry.target) ?? 0) + 1);
    }
    this.loadedConfigs.set(id, entries);

    // a declaration that replaced a removed one with the same target was updated, not added and removed
    let countUpdated = 0;
    for (const { target } of addedEntries) {
      const removedCount = target ? (removedTargets.get(target) ?? 0) : 0;
      if (removedCount === 0) continue;
      removedTargets.set(target!, removedCount - 1);
      countUpdated++;
    }

    const configName = inputFrookyConfig.metadata?.name;
    const nameSuffix = configName ? ` '${configName}'` : "";
    const hookSuffix = configName ? ` from frooky configuration '${configName}'` : "";

    logger.debug(`Frooky configuration${nameSuffix} successfully parsed`);
    this.scheduleProgressReport();

    // async resolve the new hooks and register them
    const [countSuccessfulPlatformHooks, countSuccessfulNativeHooks] = await Promise.all([
      this.resolveAndRegisterHooks(this.platformHookManger, platformToResolve, "platform").then((count) => {
        if (count > 0) logger.debug(`Successfully hooked ${count} ${this.platform} methods${hookSuffix}`);
        return count;
      }),
      this.resolveAndRegisterHooks(this.nativeHookManager, nativeToResolve, "native").then((count) => {
        if (count > 0) logger.debug(`Successfully hooked ${count} native functions${hookSuffix}`);
        return count;
      }),
    ]);

    const toResolve = [...platformToResolve, ...nativeToResolve];
    return {
      added: addedEntries.length - countUpdated,
      updated: countUpdated,
      removed: countRemoved - countUpdated,
      retried: countRetried,
      unchanged: countUnchanged,
      hookedMethods: countSuccessfulPlatformHooks,
      hookedFunctions: countSuccessfulNativeHooks,
      failed: toResolve.filter(({ entry }) => entry.state === "failed").length,
    };
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
      const settled = await Promise.allSettled(
        hookPromises.map((hookPromise, i) =>
          hookPromise.then((hooks) => {
            const entry = pendingHooks[i]?.entry;
            if (!entry || entry.state === "removed") return;
            this.scheduleProgressReport();
            if (!hooks) {
              entry.state = "failed";
              return;
            }
            const hookedCount = manager.registerHooks(hooks);
            countSuccessfulHooks += hookedCount;
            entry.hooks = hooks;
            entry.hookedCount = hookedCount;
            entry.state = "installed";
          }),
        ),
      );
      // a hook whose resolving or registering threw is neither installed nor pending anymore
      settled.forEach((result, i) => {
        const entry = pendingHooks[i]?.entry;
        if (result.status !== "rejected" || !entry || entry.state !== "pending") return;
        entry.state = "failed";
        logger.warn(
          `Failed to hook ${describeInputHook(pendingHooks[i]?.inputHook)}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
        this.scheduleProgressReport();
      });
    } catch (e) {
      for (const { entry } of pendingHooks) {
        if (entry.state === "pending") entry.state = "failed";
      }
      this.scheduleProgressReport();
      logger.error(`Error while resolving ${label} hooks: ${String(e)}`);
    }
    return countSuccessfulHooks;
  }

  /** The current {@link HookProgress} across all loaded configs. */
  public hookProgress(): HookProgress {
    let hooked = 0;
    const pendingLookups = new Set<unknown>();
    for (const entries of this.loadedConfigs.values()) {
      for (const entry of entries.values()) {
        if (entry.state === "installed") hooked += entry.hookedCount ?? 0;
        // a declaration without a known class or module counts on its own
        else if (entry.state === "pending") pendingLookups.add(entry.lookup ?? entry);
      }
    }
    return { hooked, pending: pendingLookups.size };
  }

  /**
   * Reports the {@link HookProgress} to the host shortly, at most once per {@link PROGRESS_INTERVAL_MS}.
   * The report is taken when it is sent, so it always has the latest state, including the final one
   * with nothing pending.
   */
  private scheduleProgressReport(): void {
    const reportProgress = this.reportProgress;
    if (!reportProgress || this.progressTimer !== null) return;
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null;
      reportProgress(this.hookProgress());
    }, PROGRESS_INTERVAL_MS);
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
