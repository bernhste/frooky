import { logger } from "../logger";
import { stableStringify } from "../utils";
import { Hook } from "./hook";
import { describeLookup, lookupOf, targetOf } from "./hookDescriptions";

// State of one normalized hook declaration. `target` is the hooked method or symbol, `lookup` the class
// or module it waits for, `hooks` the resolved hooks (one per overload or function). A declaration whose class or
// module isn't loaded once the lookups at targetReady have run is `waiting`: it is installed as soon as that loads.
export type LoadedHookEntry = {
  state: "resolving" | "waiting" | "installed" | "notFound" | "removed";
  target?: string;
  lookup?: string;
  // e.g. `Java class 'com.example.Foo'`, for HookStatistics
  waitsFor: string;
  hooks?: Hook[];
  hookedCount?: number;
};

export type HookToResolve = { inputHook: unknown; entry: LoadedHookEntry };

// What changed between two versions of a config. `entries` is the new version, keyed by the fingerprint of the
// normalized hook (e.g. `native:{"module":"libfoo.so",...}`). The `toResolve` entries are new, changed or retried, the
// `removedEntries` are no longer declared; their state is still the previous one. Counted in hook declarations.
export type ConfigDiff = {
  entries: Map<string, LoadedHookEntry>;
  platformToResolve: HookToResolve[];
  nativeToResolve: HookToResolve[];
  removedEntries: { fingerprint: string; entry: LoadedHookEntry }[];
  added: number;
  updated: number;
  removed: number;
  retried: number;
  unchanged: number;
};

// Diffs the normalized hooks of a config against `previousEntries`, its previously loaded version. An unchanged
// declaration keeps its entry, unless `retryNotFound` is set and it wasn't found. A retried declaration keeps its
// entry too, so it isn't counted as removed. A new declaration that replaces a removed one with the same target
// counts as updated, not as added and removed.
export function diffConfig(
  previousEntries: Map<string, LoadedHookEntry> | undefined,
  platformHooks: unknown[],
  nativeHooks: unknown[],
  retryNotFound: boolean,
): ConfigDiff {
  const entries = new Map<string, LoadedHookEntry>();
  const platformToResolve: HookToResolve[] = [];
  const nativeToResolve: HookToResolve[] = [];
  const addedEntries: LoadedHookEntry[] = [];
  let unchanged = 0;
  let retried = 0;

  const diff = (kind: string, inputHooks: unknown[], toResolve: HookToResolve[]) => {
    for (const inputHook of inputHooks) {
      const fingerprint = `${kind}:${stableStringify(inputHook)}`;
      if (entries.has(fingerprint)) {
        logger.debug(`Skipping duplicate hook declaration: ${fingerprint}`);
        continue;
      }
      const previousEntry = previousEntries?.get(fingerprint);
      if (previousEntry && !(retryNotFound && previousEntry.state === "notFound")) {
        entries.set(fingerprint, previousEntry);
        unchanged++;
        continue;
      }
      const entry: LoadedHookEntry = previousEntry ?? {
        state: "resolving",
        target: targetOf(kind, inputHook),
        lookup: lookupOf(kind, inputHook),
        waitsFor: describeLookup(inputHook),
      };
      if (previousEntry) retried++;
      else addedEntries.push(entry);
      entries.set(fingerprint, entry);
      toResolve.push({ inputHook, entry });
    }
  };
  diff("platform", platformHooks, platformToResolve);
  diff("native", nativeHooks, nativeToResolve);

  const removedEntries: ConfigDiff["removedEntries"] = [];
  const removedTargets = new Map<string, number>();
  for (const [fingerprint, previousEntry] of previousEntries ?? []) {
    if (entries.get(fingerprint) === previousEntry) continue;
    removedEntries.push({ fingerprint, entry: previousEntry });
    if (previousEntry.target) removedTargets.set(previousEntry.target, (removedTargets.get(previousEntry.target) ?? 0) + 1);
  }

  let updated = 0;
  for (const { target } of addedEntries) {
    const removedCount = target ? (removedTargets.get(target) ?? 0) : 0;
    if (removedCount === 0) continue;
    removedTargets.set(target!, removedCount - 1);
    updated++;
  }

  return {
    entries,
    platformToResolve,
    nativeToResolve,
    removedEntries,
    added: addedEntries.length - updated,
    updated,
    removed: removedEntries.length - updated,
    retried,
    unchanged,
  };
}
