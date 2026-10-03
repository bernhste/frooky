import { InputFrookyConfig } from "../frookyConfig";
import { describeNativeTarget } from "../inputParsing/inputNativeHookCollection";
import { plural } from "../utils";

// Reported to the host while hooks resolve: installed hooks (one per overload or function), classes and
// modules still being looked up, classes and modules waited for after the lookups at targetReady, and declarations
// whose method, symbol or offset wasn't found.
export type HookProgress = { hooked: number; resolving: number; waiting: number; notFound: number };

// One hook declaration for the host's hook statistics (`i` key). `target` is e.g. `com.example.Foo.bar` or
// `libfoo.so!open`, `waitsFor` the class or module it waits for, `overloads` how many overloads a Java hook
// declaration hooks (null for native hooks), `events` how many events these recorded, `filtered` how many calls their callerFilter or argFilters dropped, and
// `decodeMs` the milliseconds spent decoding the values of the recorded events.
export type HookStatistic = {
  config: string;
  target: string;
  state: "resolving" | "waiting" | "installed" | "notFound";
  waitsFor: string;
  overloads: number | null;
  events: number;
  filtered: number;
  decodeMs: number;
};

// Installed hooks (one per overload or function), declarations waiting for their class or module, and
// declarations whose method, symbol or offset wasn't found.
export type HookedSummary = {
  hookedMethods: number;
  hookedFunctions: number;
  waiting: number;
  notFound: number;
};

// Counted in hook declarations, except for the HookedSummary counts.
export type LoadSummary = HookedSummary & {
  added: number;
  updated: number;
  removed: number;
  retried: number;
  unchanged: number;
};

// The host uses the hook file path as config id, e.g. `/tmp/hooks.yaml` -> `hooks.yaml`.
export function configLabel(configId: string): string {
  return configId.split(/[\\/]/).pop() || configId;
}

// Names a config in log messages: the hook file name, else the metadata name.
export function describeConfig(inputFrookyConfig: InputFrookyConfig, configId?: string): string {
  return configId !== undefined ? configLabel(configId) : (inputFrookyConfig.metadata?.name ?? "frooky config");
}

// The class or module a hook declaration waits for, e.g. `platform:com.example.Foo`.
export function lookupOf(kind: string, inputHook: unknown): string | undefined {
  if (typeof inputHook !== "object" || inputHook === null) return undefined;
  const hook = inputHook as { javaClass?: string; classLoader?: string; module?: string };
  const lookup = hook.javaClass ?? hook.module;
  if (!lookup) return undefined;
  return hook.classLoader ? `${kind}:${lookup}@${hook.classLoader}` : `${kind}:${lookup}`;
}

// e.g. `Java class 'com.example.Foo'` or `Module 'libfoo.so'`
export function describeLookup(inputHook: unknown): string {
  const hook = (typeof inputHook === "object" && inputHook !== null ? inputHook : {}) as {
    javaClass?: string;
    classLoader?: string;
    module?: string;
  };
  if (hook.javaClass) return `Java class '${hook.javaClass}'${hook.classLoader ? ` from class loader '${hook.classLoader}'` : ""}`;
  return `Module '${hook.module}'`;
}

// e.g. `com.example.Foo.bar` or `libfoo.so!open`
export function describeInputHook(inputHook: unknown): string {
  const target = targetOf("", inputHook);
  return target ? target.slice(1) : JSON.stringify(inputHook);
}

// The method or symbol a hook declaration targets, e.g. `platform:com.example.Foo.bar`. Changing other
// properties (overloads, settings, ...) keeps the target, so a reload reports the declaration as updated.
export function targetOf(kind: string, inputHook: unknown): string | undefined {
  if (typeof inputHook !== "object" || inputHook === null) return undefined;
  const hook = inputHook as { javaClass?: string; method?: string; module?: string; symbol?: string; offset?: string };
  if (hook.javaClass && hook.method) return `${kind}:${hook.javaClass}.${hook.method}`;
  if (hook.module && (hook.symbol || hook.offset)) return `${kind}:${describeNativeTarget(hook.module, hook)}`;
  return undefined;
}

// e.g. `hooked 2 methods and 1 function, 1 waiting, 3 not found`
export function describeHooked({ hookedMethods, hookedFunctions, waiting, notFound }: HookedSummary): string {
  const hooked: string[] = [];
  if (hookedMethods > 0) hooked.push(plural(hookedMethods, "method"));
  if (hookedFunctions > 0) hooked.push(plural(hookedFunctions, "function"));
  const parts = [hooked.length > 0 ? `hooked ${hooked.join(" and ")}` : "hooked nothing"];
  if (waiting > 0) parts.push(`${waiting} waiting`);
  if (notFound > 0) parts.push(`${notFound} not found`);
  return parts.join(", ");
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
