import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { LoadedHookEntry } from "./configDiff";
import { Hook } from "./hook";
import { HookRegistry } from "./hookRegistry";

function fakeHook(): Hook {
  return { hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS };
}

function entry(state: LoadedHookEntry["state"], overrides: Partial<LoadedHookEntry> = {}): LoadedHookEntry {
  return { state, waitsFor: "Java class 'com.example.Foo'", ...overrides };
}

function entries(...list: LoadedHookEntry[]): Map<string, LoadedHookEntry> {
  return new Map(list.map((e, i) => [`platform:${i}`, e]));
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
        state: "installed",
        waitsFor: "Java class 'com.example.Foo'",
        overloads: 2,
        events: 3,
        filtered: 0,
        decodeMs: 6,
      },
      {
        config: "hooks.yaml",
        target: "libfoo.so!open",
        state: "waiting",
        waitsFor: "Module 'libfoo.so'",
        overloads: null,
        events: 0,
        filtered: 0,
        decodeMs: 0,
      },
    ]);
  });
});
