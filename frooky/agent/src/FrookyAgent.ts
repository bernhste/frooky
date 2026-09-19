import { NativeHookManager } from "./native/hook/nativeHookManager";
import { NativeHookValidator } from "./native/hook/nativeHookValidator";
import { validateAndRepairFrookyConfig } from "./shared/configValidator";
import { CrashReport, installCrashReporter } from "./shared/crashReporter";
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
import { PlatformHookManager } from "./shared/hook/hookManager";
import { HookValidator } from "./shared/hook/hookValidator";
import { describeNativeTarget } from "./shared/inputParsing/inputNativeHookCollection";
import { logger, LogLevel, LogTo } from "./shared/logger";
import { PlatformStackTrace } from "./shared/platformStackTrace";
import { plural, stableStringify } from "./shared/utils";

// State of one normalized hook declaration. `target` is the hooked method or symbol, `lookup` the class
// or module it waits for, `hooks` the resolved hooks (one per overload or function).
type LoadedHookEntry = {
  state: "pending" | "installed" | "failed" | "removed";
  target?: string;
  lookup?: string;
  hooks?: Hook[];
  hookedCount?: number;
};

type PendingHook = { inputHook: unknown; entry: LoadedHookEntry };

// The host uses the hook file path as config id, e.g. `/tmp/hooks.yaml` -> `hooks.yaml`.
function configLabel(configId: string): string {
  return configId.split(/[\\/]/).pop() || configId;
}

// Names a config in log messages: the hook file name, else the metadata name.
function describeConfig(inputFrookyConfig: InputFrookyConfig, configId?: string): string {
  return configId !== undefined ? configLabel(configId) : (inputFrookyConfig.metadata?.name ?? "frooky config");
}

// The class or module a hook declaration waits for, e.g. `platform:com.example.Foo`.
function lookupOf(kind: string, inputHook: unknown): string | undefined {
  if (typeof inputHook !== "object" || inputHook === null) return undefined;
  const hook = inputHook as { javaClass?: string; module?: string };
  const lookup = hook.javaClass ?? hook.module;
  return lookup ? `${kind}:${lookup}` : undefined;
}

// e.g. `com.example.Foo.bar` or `libfoo.so!open`
function describeInputHook(inputHook: unknown): string {
  const target = targetOf("", inputHook);
  return target ? target.slice(1) : JSON.stringify(inputHook);
}

// The method or symbol a hook declaration targets, e.g. `platform:com.example.Foo.bar`. Changing other
// properties (overloads, settings, ...) keeps the target, so a reload reports the declaration as updated.
function targetOf(kind: string, inputHook: unknown): string | undefined {
  if (typeof inputHook !== "object" || inputHook === null) return undefined;
  const hook = inputHook as { javaClass?: string; method?: string; module?: string; symbol?: string; offset?: string };
  if (hook.javaClass && hook.method) return `${kind}:${hook.javaClass}.${hook.method}`;
  if (hook.module && (hook.symbol || hook.offset)) return `${kind}:${describeNativeTarget(hook.module, hook)}`;
  return undefined;
}

// Reported to the host while hooks resolve: installed hooks (one per overload or function), classes and
// modules still being looked up, and declarations that failed to resolve.
export type HookProgress = { hooked: number; pending: number; failed: number };

// Installed hooks (one per overload or function) and declarations that failed to resolve.
type HookedSummary = {
  hookedMethods: number;
  hookedFunctions: number;
  failed: number;
};

// Counted in hook declarations, except for the HookedSummary counts.
type LoadSummary = HookedSummary & {
  added: number;
  updated: number;
  removed: number;
  retried: number;
  unchanged: number;
};

// e.g. `hooked 2 methods and 1 function, 3 not resolved`
export function describeHooked({ hookedMethods, hookedFunctions, failed }: HookedSummary): string {
  const hooked: string[] = [];
  if (hookedMethods > 0) hooked.push(plural(hookedMethods, "method"));
  if (hookedFunctions > 0) hooked.push(plural(hookedFunctions, "function"));
  const text = hooked.length > 0 ? `hooked ${hooked.join(" and ")}` : "hooked nothing";
  return failed > 0 ? `${text}, ${failed} not resolved` : text;
}

// e.g. `1 new, 1 updated, 1 removed, 3 unchanged; hooked 2 methods`. The part after the semicolon
// covers the new, updated and retried declarations.
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

// Loads hook configs, installs their hooks and collects the events.
export class FrookyAgent {
  private eventCache: BaseEvent[] = [];
  private platform: Platform;
  private platformHookValidator: HookValidator<any, any>;
  private platformHookManger: PlatformHookManager<any, any>;
  private nativeHookValidator = new NativeHookValidator();
  private nativeHookManager: NativeHookManager;
  private resolverTimeoutSeconds: number;
  // hooks of every loaded config, keyed by config id and then by the fingerprint of the normalized hook
  private loadedConfigs = new Map<string, Map<string, LoadedHookEntry>>();
  private anonymousConfigCount = 0;
  private reportProgress?: (progress: HookProgress) => void;
  public readonly targetReady: Promise<void>; // resolves once the target's own code can be looked up (e.g. Java.perform())
  private progressTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    platform: Platform,
    platformInputHookValidator: HookValidator<any, any>,
    createPlatformHookManager: (frookyAgent: FrookyAgent) => PlatformHookManager<any, any>,
    platformStackTrace: PlatformStackTrace,
    logLevel: LogLevel = DEFAULT_SETTING_LOG_LEVEL,
    logTo: LogTo = DEFAULT_SETTING_LOG_TO,
    resolverTimeoutSeconds: number = DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
    reportProgress?: (progress: HookProgress) => void,
    targetReady: Promise<void> = Promise.resolve(),
  ) {
    startEventSender(this.eventCache);

    this.platform = platform;
    this.platformHookValidator = platformInputHookValidator;
    this.resolverTimeoutSeconds = resolverTimeoutSeconds;
    this.reportProgress = reportProgress;
    this.targetReady = targetReady;
    this.nativeHookManager = new NativeHookManager(platformStackTrace, this);
    this.platformHookManger = createPlatformHookManager(this);

    logger.setAgent(this);
    logger.setVerbosity(logLevel);
    logger.setLogTo(logTo);

    logger.info(`Target: ${this.platform} (${Process.platform}/${Process.arch}), pid ${Process.id}, Frida ${Frida.version}`);
    logger.debug(`Target process:\n${JSON.stringify(Process, null, 2)}`);
  }

  // Sends a CrashReport when the process is about to die from a native exception, see installCrashReporter().
  public reportCrashes(report: (crash: CrashReport) => void): void {
    installCrashReporter(this.nativeHookManager, report);
  }

  // Loads configs concurrently. `configIds` are index-aligned with `inputFrookyConfigs`, see loadFrookyConfig().
  // The final HookProgress report tells the host that all hooks are resolved.
  public async loadFrookyConfigs(inputFrookyConfigs: InputFrookyConfig[], configIds?: string[]) {
    await Promise.all(
      inputFrookyConfigs.map((inputFrookyConfig, i) =>
        this.applyFrookyConfig(inputFrookyConfig, configIds?.[i])
          .then((summary) => {
            if (summary) logger.info(`Loaded ${describeConfig(inputFrookyConfig, configIds?.[i])}: ${describeLoad(summary)}`);
          })
          .catch((e) => {
            logger.error(`Error during loading of the frooky config: ${String(e)}`);
          }),
      ),
    );
    // also when no config was valid, so the host stops waiting for a report
    this.scheduleProgressReport();
  }

  // Loads a config and logs what changed, e.g. `Updated hooks.yaml: 1 new, 3 unchanged; hooked 2 methods`.
  // A config with a known `configId` (the host uses the hook file path) replaces the previous version
  // incrementally: unchanged hooks stay installed, removed ones are unhooked, new and changed ones are resolved.
  // Failed hooks are retried if `retryFailed` is set or their declaration changed. An invalid config keeps the
  // previous version. The diff runs before the first `await`, so consecutive calls apply in order.
  public async loadFrookyConfig(inputFrookyConfig: InputFrookyConfig, configId?: string, retryFailed = false) {
    const isReload = configId !== undefined && this.loadedConfigs.has(configId);
    const summary = await this.applyFrookyConfig(inputFrookyConfig, configId, retryFailed);
    this.scheduleProgressReport();
    if (!summary) return;
    const verb = !isReload ? "Loaded" : retryFailed ? "Reloaded" : "Updated";
    logger.info(`${verb} ${describeConfig(inputFrookyConfig, configId)}: ${describeLoad(summary)}`);
  }

  // loadFrookyConfig() without the summary log. Returns `undefined` if the config is invalid.
  private async applyFrookyConfig(inputFrookyConfig: InputFrookyConfig, configId?: string, retryFailed = false): Promise<LoadSummary | undefined> {
    const label = describeConfig(inputFrookyConfig, configId);
    logger.debug(`Parsing ${label}`);

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

    logger.info(
      `Parsed ${label}: ${plural(validPlatformHooks.length, `${this.platform} hook`)} and ${plural(validNativeHook.length, "native hook")}, ${platformToResolve.length + nativeToResolve.length} to resolve`,
    );
    this.scheduleProgressReport();

    // resolve and install the new, changed and retried hooks
    const [countSuccessfulPlatformHooks, countSuccessfulNativeHooks] = await Promise.all([
      this.resolveAndRegisterHooks(this.platformHookManger, platformToResolve, "platform", label),
      this.resolveAndRegisterHooks(this.nativeHookManager, nativeToResolve, "native", label),
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

  // Resolves and installs hooks and returns how many were installed. A hook whose entry was removed while it
  // resolved (the config was reloaded) is not installed. `source` names the hook file in log messages.
  private async resolveAndRegisterHooks(
    manager: PlatformHookManager<any, any>,
    pendingHooks: PendingHook[],
    kind: string,
    source: string,
  ): Promise<number> {
    if (pendingHooks.length === 0) return 0;

    let countSuccessfulHooks = 0;
    try {
      const hookPromises = await manager.resolveHooks(
        pendingHooks.map((pendingHook) => pendingHook.inputHook),
        this.resolverTimeoutSeconds,
        source,
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
            const hookedCount = manager.registerHooks(hooks, source);
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
          `Failed to hook ${describeInputHook(pendingHooks[i]?.inputHook)} (${source}): ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
        this.scheduleProgressReport();
      });
    } catch (e) {
      for (const { entry } of pendingHooks) {
        if (entry.state === "pending") entry.state = "failed";
      }
      this.scheduleProgressReport();
      logger.error(`Error while resolving ${kind} hooks of ${source}: ${String(e)}`);
    }
    return countSuccessfulHooks;
  }

  // HookProgress across all loaded configs
  public hookProgress(): HookProgress {
    let hooked = 0;
    let failed = 0;
    const pendingLookups = new Set<unknown>();
    for (const entries of this.loadedConfigs.values()) {
      for (const entry of entries.values()) {
        if (entry.state === "installed") hooked += entry.hookedCount ?? 0;
        // a declaration without a known class or module counts on its own
        else if (entry.state === "pending") pendingLookups.add(entry.lookup ?? entry);
        else if (entry.state === "failed") failed++;
      }
    }
    return { hooked, pending: pendingLookups.size, failed };
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

  public addEventToLog(event: LogEvent | HookEvent): void {
    this.eventCache.push(event);
  }
}
