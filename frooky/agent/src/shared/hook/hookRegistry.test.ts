import { DEFAULT_BASE_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { LoadedHookEntry } from "./configDiff";
import { Hook } from "./hook";
import { HookLookup, HookRegistry } from "./hookRegistry";

function fakeHook(): Hook {
  return { hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_BASE_DECODER_SETTINGS };
}

function entry(state: LoadedHookEntry["state"], overrides: Partial<LoadedHookEntry> = {}): LoadedHookEntry {
  return { state, waitsFor: "Java class 'com.example.Foo'", ...overrides };
}

function entries(...list: LoadedHookEntry[]): Map<string, LoadedHookEntry> {
  return new Map(list.map((e, i) => [`platform:${i}`, e]));
}

// a hook manager that has installed the hooks of `targets` on their targets: hooks with the same target share it
function lookupOf(targets: Map<Hook, string>): (fingerprint: string) => HookLookup {
  const lookup: HookLookup = {
    describeInstalledHook: (hook) => targets.get(hook),
    otherHooksOnSameFunction: (hook) => [...targets.keys()].filter((other) => other !== hook && targets.get(other) === targets.get(hook)),
  };
  return () => lookup;
}

describe("HookRegistry", () => {
  it("returns the config id, or a new one for a config without one", () => {
    const registry = new HookRegistry();

    expect(registry.idOf("/tmp/hooks.yaml")).toBe("/tmp/hooks.yaml");
    expect(registry.idOf()).toBe("#1");
    expect(registry.idOf()).toBe("#2");
  });

  it("counts installed hooks, and resolving and waiting declarations once per class or module", () => {
    const registry = new HookRegistry();
    registry.set(
      "a.yaml",
      entries(
        entry("installed", { hookedCount: 2 }),
        entry("resolving", { lookup: "platform:com.example.Foo" }),
        entry("resolving", { lookup: "platform:com.example.Foo" }),
        entry("waiting", { lookup: "native:libfoo.so" }),
        entry("notFound"),
        entry("removed", { hookedCount: 5 }),
      ),
    );
    registry.set("b.yaml", entries(entry("installed", { hookedCount: 1 }), entry("resolving")));

    expect(registry.progress()).toEqual({ hooked: 3, resolving: 2, waiting: 1, notFound: 1 });
  });

  it("reports the statistics of every declaration that isn't removed", () => {
    const registry = new HookRegistry();
    const hooks = [fakeHook(), fakeHook()];
    registry.set(
      "/tmp/hooks.yaml",
      entries(
        entry("installed", { target: "platform:com.example.Foo.bar", hooks, hookedCount: 2 }),
        entry("waiting", { target: "native:libfoo.so!open", waitsFor: "Module 'libfoo.so'" }),
        entry("removed", { target: "platform:com.example.Foo.baz" }),
      ),
    );
    registry.countEvent(hooks[0], 3);
    registry.countEvent(hooks[0], 1);
    registry.countEvent(hooks[1], 2);

    expect(registry.statistics()).toEqual([
      {
        config: "hooks.yaml",
        target: "com.example.Foo.bar",
        declaration: "com.example.Foo.bar",
        state: "installed",
        waitsFor: "Java class 'com.example.Foo'",
        overloads: 2,
        events: 3,
        filtered: 0,
        decodeMs: 6,
        alsoHookedBy: [],
      },
      {
        config: "hooks.yaml",
        target: "libfoo.so!open",
        declaration: "libfoo.so!open",
        state: "waiting",
        waitsFor: "Module 'libfoo.so'",
        overloads: null,
        events: 0,
        filtered: 0,
        decodeMs: 0,
        alsoHookedBy: [],
      },
    ]);
  });

  it("lists each method or function an installed declaration hooks, with the events of its hooks", () => {
    const registry = new HookRegistry();
    const [receiveInt, receiveString, receiveBoolean, uninstalled] = [fakeHook(), fakeHook(), fakeHook(), fakeHook()];
    const [intRef, uintRef] = [fakeHook(), fakeHook()];
    const targets = new Map<Hook, string>([
      [receiveInt, "com.example.Foo.receive"],
      [receiveString, "com.example.Foo.receive"],
      [receiveBoolean, "com.example.Bar.receiveBoolean"],
      [intRef, "libfoo.so!receive_int_ref"],
      [uintRef, "libfoo.so!receive_uint_ref"],
    ]);
    registry.set(
      "hooks.yaml",
      new Map([
        [
          "platform:0",
          entry("installed", {
            target: "platform:com.example.*.receive*",
            hooks: [receiveInt, receiveString, receiveBoolean, uninstalled],
            hookedCount: 3,
          }),
        ],
        [
          "native:1",
          entry("installed", { target: "native:libfoo.so!receive_*", waitsFor: "Module 'libfoo.so'", hooks: [intRef, uintRef], hookedCount: 2 }),
        ],
        ["platform:2", entry("waiting", { target: "platform:com.example.*.send*" })],
      ]),
    );
    registry.countEvent(receiveString, 1);
    registry.countEvent(receiveBoolean, 2);
    registry.countEvent(uintRef, 3);

    const fingerprints: string[] = [];
    const statistics = registry.statistics((fingerprint) => {
      fingerprints.push(fingerprint);
      return { describeInstalledHook: (hook) => targets.get(hook), otherHooksOnSameFunction: () => [] };
    });

    expect(new Set(fingerprints)).toEqual(new Set(["platform:0", "native:1"]));
    expect(
      statistics.map(({ target, declaration, state, overloads, events, decodeMs }) => ({ target, declaration, state, overloads, events, decodeMs })),
    ).toEqual([
      { target: "com.example.Foo.receive", declaration: "com.example.*.receive*", state: "installed", overloads: 2, events: 1, decodeMs: 1 },
      { target: "com.example.Bar.receiveBoolean", declaration: "com.example.*.receive*", state: "installed", overloads: 1, events: 1, decodeMs: 2 },
      { target: "libfoo.so!receive_int_ref", declaration: "libfoo.so!receive_*", state: "installed", overloads: null, events: 0, decodeMs: 0 },
      { target: "libfoo.so!receive_uint_ref", declaration: "libfoo.so!receive_*", state: "installed", overloads: null, events: 1, decodeMs: 3 },
      { target: "com.example.*.send*", declaration: "com.example.*.send*", state: "waiting", overloads: 0, events: 0, decodeMs: 0 },
    ]);
  });

  it("lists an installed declaration whose hooks all failed to install as one row", () => {
    const registry = new HookRegistry();
    registry.set("hooks.yaml", entries(entry("installed", { target: "platform:com.example.*.bar", hooks: [fakeHook()], hookedCount: 0 })));

    expect(registry.statistics(lookupOf(new Map())).map(({ target, overloads }) => [target, overloads])).toEqual([["com.example.*.bar", 0]]);
  });

  it("names the other declarations that hook the same function or overloads, also of another config", () => {
    const registry = new HookRegistry();
    // com.example.Foo.bar has 3 overloads: `com.example.*.b*` hooks 2 of them, `com.example.Foo.bar` all of them
    const [bar1, bar2, bar3, wildBar1, wildBar2] = [fakeHook(), fakeHook(), fakeHook(), fakeHook(), fakeHook()];
    const [memcpy, memmove, otherMemcpy] = [fakeHook(), fakeHook(), fakeHook()];
    const overloadOf = new Map<Hook, string>([
      [bar1, "bar(int)"],
      [bar2, "bar(String)"],
      [bar3, "bar()"],
      [wildBar1, "bar(int)"],
      [wildBar2, "bar(String)"],
      [memcpy, "memcpy"],
      [memmove, "memcpy"],
      [otherMemcpy, "memcpy"],
    ]);
    const targets = new Map<Hook, string>([
      [bar1, "com.example.Foo.bar"],
      [bar2, "com.example.Foo.bar"],
      [bar3, "com.example.Foo.bar"],
      [wildBar1, "com.example.Foo.bar"],
      [wildBar2, "com.example.Foo.bar"],
      [memcpy, "libc.so!memcpy"],
      // memmove is the same function as memcpy in some libcs
      [memmove, "libc.so!memmove"],
      [otherMemcpy, "libc.so!memcpy"],
    ]);
    registry.set(
      "/tmp/a.yaml",
      new Map([
        ["platform:0", entry("installed", { target: "platform:com.example.Foo.bar", hooks: [bar1, bar2, bar3], hookedCount: 3 })],
        ["platform:1", entry("installed", { target: "platform:com.example.*.b*", hooks: [wildBar1, wildBar2], hookedCount: 2 })],
        ["native:2", entry("installed", { target: "native:libc.so!memcpy", hooks: [memcpy], hookedCount: 1 })],
        ["native:3", entry("installed", { target: "native:libc.so!memmove", hooks: [memmove], hookedCount: 1 })],
      ]),
    );
    registry.set("/tmp/b.yaml", new Map([["native:0", entry("installed", { target: "native:libc.so!mem*", hooks: [otherMemcpy], hookedCount: 1 })]]));

    const statistics = registry.statistics(() => ({
      describeInstalledHook: (hook) => targets.get(hook),
      otherHooksOnSameFunction: (hook) => [...overloadOf.keys()].filter((other) => other !== hook && overloadOf.get(other) === overloadOf.get(hook)),
    }));

    expect(statistics.map(({ config, declaration, alsoHookedBy }) => [config, declaration, alsoHookedBy])).toEqual([
      ["a.yaml", "com.example.Foo.bar", [{ config: "a.yaml", declaration: "com.example.*.b*", target: "com.example.Foo.bar", overloads: 2 }]],
      ["a.yaml", "com.example.*.b*", [{ config: "a.yaml", declaration: "com.example.Foo.bar", target: "com.example.Foo.bar", overloads: 2 }]],
      [
        "a.yaml",
        "libc.so!memcpy",
        [
          { config: "a.yaml", declaration: "libc.so!memmove", target: "libc.so!memmove", overloads: null },
          { config: "b.yaml", declaration: "libc.so!mem*", target: "libc.so!memcpy", overloads: null },
        ],
      ],
      [
        "a.yaml",
        "libc.so!memmove",
        [
          { config: "a.yaml", declaration: "libc.so!memcpy", target: "libc.so!memcpy", overloads: null },
          { config: "b.yaml", declaration: "libc.so!mem*", target: "libc.so!memcpy", overloads: null },
        ],
      ],
      [
        "b.yaml",
        "libc.so!mem*",
        [
          { config: "a.yaml", declaration: "libc.so!memcpy", target: "libc.so!memcpy", overloads: null },
          { config: "a.yaml", declaration: "libc.so!memmove", target: "libc.so!memmove", overloads: null },
        ],
      ],
    ]);
  });
});
