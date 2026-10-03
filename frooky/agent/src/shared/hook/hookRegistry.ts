import { LoadedHookEntry } from "./configDiff";
import { filteredCallCount, Hook } from "./hook";
import { configLabel, HookProgress, HookStatistic } from "./hookDescriptions";

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

  // Every hook declaration of the loaded configs, see HookStatistic
  statistics(): HookStatistic[] {
    const statistics: HookStatistic[] = [];
    for (const [configId, entries] of this.configs) {
      for (const [fingerprint, entry] of entries) {
        if (entry.state === "removed") continue;
        statistics.push({
          config: configLabel(configId),
          target: entry.target ? entry.target.slice(entry.target.indexOf(":") + 1) : fingerprint,
          state: entry.state,
          waitsFor: entry.waitsFor,
          overloads: entry.target?.startsWith("platform:") ? (entry.hookedCount ?? 0) : null,
          events: (entry.hooks ?? []).reduce((count, hook) => count + (this.eventCounts.get(hook) ?? 0), 0),
          filtered: (entry.hooks ?? []).reduce((count, hook) => count + filteredCallCount(hook), 0),
          decodeMs: (entry.hooks ?? []).reduce((ms, hook) => ms + (this.decodeTimes.get(hook) ?? 0), 0),
        });
      }
    }
    return statistics;
  }
}
