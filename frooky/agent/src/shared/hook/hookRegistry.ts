import { LoadedHookEntry } from "./configDiff";
import { filteredCallCount, Hook } from "./hook";
import { AlsoHookedBy, configLabel, HookProgress, HookStatistic } from "./hookDescriptions";

// The hook declarations of every loaded config and the events their hooks recorded
export class HookRegistry {
  // keyed by config id and then by the fingerprint of the normalized hook, see diffConfig()
  private readonly configs = new Map<string, Map<string, LoadedHookEntry>>();
  private anonymousConfigCount = 0;
  private readonly eventCounts = new WeakMap<Hook, number>();
  // Summed Date.now() differences of whole milliseconds. Over many calls they add up to the real time, at a tenth of
  // the cost of a high-resolution clock, which Frida only has as a NativeFunction call of clock_gettime().
  private readonly decodeTimes = new WeakMap<Hook, number>();

  has(configId: string): boolean {
    return this.configs.has(configId);
  }

  get(configId: string): Map<string, LoadedHookEntry> | undefined {
    return this.configs.get(configId);
  }

  set(configId: string, entries: Map<string, LoadedHookEntry>): void {
    this.configs.set(configId, entries);
  }

  // `configId`, or a new id such as `#1` for a config loaded without one
  idOf(configId?: string): string {
    return configId ?? `#${++this.anonymousConfigCount}`;
  }

  // `decodeMs` is the time `hook` spent decoding the values of one event
  countEvent(hook: Hook, decodeMs: number): void {
    this.eventCounts.set(hook, (this.eventCounts.get(hook) ?? 0) + 1);
    this.decodeTimes.set(hook, (this.decodeTimes.get(hook) ?? 0) + decodeMs);
  }

  // HookProgress across all loaded configs
  progress(): HookProgress {
    let hooked = 0;
    let notFound = 0;
    // a declaration without a known class or module counts on its own
    const resolvingLookups = new Set<unknown>();
    const waitingLookups = new Set<unknown>();
    for (const entries of this.configs.values()) {
      for (const entry of entries.values()) {
        if (entry.state === "installed") hooked += entry.hookedCount ?? 0;
        else if (entry.state === "resolving") resolvingLookups.add(entry.lookup ?? entry);
        else if (entry.state === "waiting") waitingLookups.add(entry.lookup ?? entry);
        else if (entry.state === "notFound") notFound++;
      }
    }
    return { hooked, resolving: resolvingLookups.size, waiting: waitingLookups.size, notFound };
  }

  // Every hook declaration of the loaded configs, see HookStatistic. An installed declaration gets one row per method
  // or function `lookup` names for its hooks, e.g. one per class and method a wildcard pattern matched; a hook it names
  // no target for (one that isn't installed) is left out. Without any named target, the declaration is one row.
  // `lookup` is the hook manager of a declaration, by its fingerprint.
  statistics(lookup?: (fingerprint: string) => HookLookup): HookStatistic[] {
    // the declaration of each installed hook, for AlsoHookedBy
    const owners = new Map<Hook, { config: string; declaration: string; fingerprint: string; entry: LoadedHookEntry }>();
    for (const [configId, entries] of this.configs) {
      for (const [fingerprint, entry] of entries) {
        if (entry.state !== "installed") continue;
        for (const hook of entry.hooks ?? [])
          owners.set(hook, { config: configLabel(configId), declaration: declarationOf(fingerprint, entry), fingerprint, entry });
      }
    }

    const statistics: HookStatistic[] = [];
    for (const [configId, entries] of this.configs) {
      for (const [fingerprint, entry] of entries) {
        const state = entry.state;
        if (state === "removed") continue;
        const declaration = declarationOf(fingerprint, entry);
        const isPlatform = entry.target?.startsWith("platform:") ?? false;
        const alsoHookedBy = (hooks: Hook[]): AlsoHookedBy[] => {
          if (!lookup) return [];
          const others = new Map<string, AlsoHookedBy>();
          for (const hook of hooks) {
            // counted once per hook of this row, also if the other declaration has several hooks on its function
            const counted = new Set<string>();
            for (const other of lookup(fingerprint).otherHooksOnSameFunction(hook)) {
              const owner = owners.get(other);
              if (!owner || owner.entry === entry) continue;
              const target = lookup(owner.fingerprint).describeInstalledHook(other) ?? owner.declaration;
              const key = JSON.stringify([owner.config, owner.declaration, target]);
              if (counted.has(key)) continue;
              counted.add(key);
              const known = others.get(key) ?? { config: owner.config, declaration: owner.declaration, target, overloads: isPlatform ? 0 : null };
              if (known.overloads !== null) known.overloads++;
              others.set(key, known);
            }
          }
          return [...others.values()];
        };
        const row = (target: string, hooks: Hook[], overloads: number): HookStatistic => ({
          config: configLabel(configId),
          target,
          declaration,
          state,
          waitsFor: entry.waitsFor,
          overloads: isPlatform ? overloads : null,
          events: hooks.reduce((count, hook) => count + (this.eventCounts.get(hook) ?? 0), 0),
          filtered: hooks.reduce((count, hook) => count + filteredCallCount(hook), 0),
          decodeMs: hooks.reduce((ms, hook) => ms + (this.decodeTimes.get(hook) ?? 0), 0),
          alsoHookedBy: state === "installed" ? alsoHookedBy(hooks) : [],
        });
        const hooksByTarget = new Map<string, Hook[]>();
        if (state === "installed" && lookup) {
          for (const hook of entry.hooks ?? []) {
            const target = lookup(fingerprint).describeInstalledHook(hook);
            if (target !== undefined) hooksByTarget.set(target, [...(hooksByTarget.get(target) ?? []), hook]);
          }
        }
        if (hooksByTarget.size === 0) statistics.push(row(declaration, entry.hooks ?? [], entry.hookedCount ?? 0));
        for (const [target, hooks] of hooksByTarget) statistics.push(row(target, hooks, hooks.length));
      }
    }
    return statistics;
  }
}

// What HookRegistry.statistics() asks the hook manager of a declaration, see HookManager
export type HookLookup = {
  describeInstalledHook: (hook: Hook) => string | undefined;
  otherHooksOnSameFunction: (hook: Hook) => Hook[];
};

// e.g. `com.example.*.get*` for the fingerprint of a declaration without a target
function declarationOf(fingerprint: string, entry: LoadedHookEntry): string {
  return entry.target ? entry.target.slice(entry.target.indexOf(":") + 1) : fingerprint;
}
