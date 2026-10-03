import { diffConfig, LoadedHookEntry } from "./configDiff";

const fooBar = { javaClass: "com.example.Foo", method: "bar" };
const fooBaz = { javaClass: "com.example.Foo", method: "baz" };
const open = { module: "libc.so", symbol: "open" };

// the entries of a first load, with every entry in `state`
function loaded(platformHooks: unknown[], nativeHooks: unknown[], state: LoadedHookEntry["state"] = "installed"): Map<string, LoadedHookEntry> {
  const { entries } = diffConfig(undefined, platformHooks, nativeHooks, false);
  for (const entry of entries.values()) entry.state = state;
  return entries;
}

describe("diffConfig()", () => {
  it("resolves every declaration of a first load", () => {
    const diff = diffConfig(undefined, [fooBar], [open], false);

    expect(diff.platformToResolve.map(({ inputHook }) => inputHook)).toEqual([fooBar]);
    expect(diff.nativeToResolve.map(({ inputHook }) => inputHook)).toEqual([open]);
    expect(diff.added).toBe(2);
    expect(diff.removedEntries).toEqual([]);
  });

  it("describes a new entry by its target and the class or module it waits for", () => {
    const [entry] = diffConfig(undefined, [], [open], false).entries.values();

    expect(entry).toEqual({ state: "resolving", target: "native:libc.so!open", lookup: "native:libc.so", waitsFor: "Module 'libc.so'" });
  });

  it("keeps the entries of unchanged declarations", () => {
    const previous = loaded([fooBar], [open]);
    const diff = diffConfig(previous, [fooBar], [open], false);

    expect(diff.unchanged).toBe(2);
    expect(diff.platformToResolve).toEqual([]);
    expect(diff.nativeToResolve).toEqual([]);
    expect([...diff.entries.values()]).toEqual([...previous.values()]);
  });

  it("returns the removed entries with their previous state", () => {
    const previous = loaded([fooBar], [open]);
    const diff = diffConfig(previous, [fooBar], [], false);

    expect(diff.removed).toBe(1);
    expect(diff.removedEntries.map(({ fingerprint }) => fingerprint.split(":")[0])).toEqual(["native"]);
    expect(diff.removedEntries[0].entry.state).toBe("installed");
  });

  it("counts a declaration that replaces one with the same target as updated", () => {
    const previous = loaded([fooBar], []);
    const diff = diffConfig(previous, [{ ...fooBar, overloads: [{ params: [] }] }], [], false);

    expect(diff.updated).toBe(1);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.removedEntries.length).toBe(1);
  });

  it("retries only declarations that were not found, keeping their entries", () => {
    const previous = new Map([...loaded([fooBar], []), ...loaded([fooBaz], [], "notFound")]);
    const diff = diffConfig(previous, [fooBar, fooBaz], [], true);

    expect(diff.retried).toBe(1);
    expect(diff.unchanged).toBe(1);
    expect(diff.platformToResolve.map(({ inputHook }) => inputHook)).toEqual([fooBaz]);
    expect(diff.removedEntries).toEqual([]);
  });

  it("does not retry not found declarations without retryNotFound", () => {
    const diff = diffConfig(loaded([fooBaz], [], "notFound"), [fooBaz], [], false);

    expect(diff.unchanged).toBe(1);
    expect(diff.platformToResolve).toEqual([]);
  });

  it("skips duplicate declarations", () => {
    const diff = diffConfig(undefined, [fooBar, { ...fooBar }], [], false);

    expect(diff.entries.size).toBe(1);
    expect(diff.added).toBe(1);
  });

  it("does not change the state of previous entries", () => {
    const previous = loaded([fooBaz], [open], "notFound");
    diffConfig(previous, [fooBaz], [], true);

    expect([...previous.values()].map(({ state }) => state)).toEqual(["notFound", "notFound"]);
  });
});
