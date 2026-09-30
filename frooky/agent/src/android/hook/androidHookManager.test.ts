import Java from "frida-java-bridge";
import { FrookyAgent } from "../../FrookyAgent";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { InputJavaHookNormalized } from "../../shared/inputParsing/inputJavaHookCollection";
import { HookSettings } from "../../shared/frookySettings";
import { PlatformStackTrace } from "../../shared/platformStackTrace";
import { FilterMismatchError, formatHashCode } from "../../shared/utils";
import { AndroidHookManager } from "./androidHookManager";
import { JavaHook } from "./javaHook";
import { JavaHookEvent } from "./javaHookEvent";

// resolveHooks() installs nothing, so it can run against always-loaded classes like java.lang.String
const stackTrace: PlatformStackTrace = { build: () => ({ platformStackTrace: [], nativeStackTrace: [] }) };
const frookyAgent = {} as FrookyAgent;

function javaHook(javaClass: string, method: string): InputJavaHookNormalized {
  return { javaClass, method, hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS };
}

describe("AndroidHookManager", () => {
  describe("resolveHooks()", () => {
    it("resolves an exact javaClass and hooks all overloads of the method", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      const results = await Promise.all(await manager.resolveHooks([javaHook("java.lang.String", "length")], 5));

      expect(results.length).toBe(1);
      const hooks = results[0] as JavaHook[];
      expect(hooks).not.toBeNull();
      expect(hooks.length).toBeGreaterThan(0);
      expect(hooks.every((hook) => hook.methodName === "length")).toBeTruthy();
    });

    it("hooks every overload of a method that has more than one", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      const results = await Promise.all(await manager.resolveHooks([javaHook("java.lang.String", "indexOf")], 5));

      const hooks = results[0] as JavaHook[];
      expect(hooks).not.toBeNull();
      expect(hooks.length).toBeGreaterThan(1);
      expect(hooks.every((hook) => hook.methodName === "indexOf")).toBeTruthy();
    });

    it("returns null when the javaClass does not exist", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      // timeout 0: fail after the first lookup instead of polling
      const results = await Promise.all(await manager.resolveHooks([javaHook("com.frooky.test.DoesNotExist", "foo")], 0));

      expect(results).toEqual([null]);
    });

    it("returns null when the method does not exist on an otherwise resolved class", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      const results = await Promise.all(await manager.resolveHooks([javaHook("java.lang.String", "thisMethodDoesNotExist")], 2));

      expect(results).toEqual([null]);
    });

    it("resolves a wildcard javaClass to every currently loaded matching class", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      // java.lang.Object and java.lang.String are always loaded, both declare toString(), and
      // '*' must match the single 'lang' segment without crossing into e.g. 'java.lang.reflect'.
      const results = await Promise.all(await manager.resolveHooks([javaHook("java.lang.*", "toString")], 5));

      const hooks = results[0] as JavaHook[];
      expect(hooks).not.toBeNull();
      expect(hooks.length).toBeGreaterThan(0);
      expect(hooks.every((hook) => hook.methodName === "toString")).toBeTruthy();
    });

    it("returns null for a wildcard javaClass that matches no loaded class", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      // timeout 0: fail after the first lookup instead of polling
      const results = await Promise.all(await manager.resolveHooks([javaHook("com.frooky.test.*.DoesNotExist", "foo")], 0));

      expect(results).toEqual([null]);
    });

    it("processes hooks for different classes independently", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      const results = await Promise.all(
        await manager.resolveHooks([javaHook("java.lang.String", "length"), javaHook("java.lang.Object", "hashCode")], 5),
      );

      expect(results.length).toBe(2);
      expect(results.every((hooks) => hooks !== null && hooks.length > 0)).toBeTruthy();
    });

    it("carries an overload's retType decoder settings onto the resolved JavaHook", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);
      const retTypeSettings = { ...DEFAULT_DECODER_SETTINGS, decoder: "myDecoder" };
      const hook: InputJavaHookNormalized = {
        javaClass: "java.lang.String",
        method: "indexOf",
        hookSettings: DEFAULT_HOOK_SETTINGS,
        decoderSettings: DEFAULT_DECODER_SETTINGS,
        overloads: [{ params: ["int"], retType: retTypeSettings }],
      };

      const results = await Promise.all(await manager.resolveHooks([hook], 5));
      const hooks = results[0] as JavaHook[];

      expect(hooks.length).toBe(1);
      expect(hooks[0].retTypeSettings).toEqual(retTypeSettings);
    });

    it("leaves retTypeSettings undefined when an overload does not declare a retType", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);
      const hook: InputJavaHookNormalized = {
        javaClass: "java.lang.String",
        method: "indexOf",
        hookSettings: DEFAULT_HOOK_SETTINGS,
        decoderSettings: DEFAULT_DECODER_SETTINGS,
        overloads: [{ params: ["int"] }],
      };

      const results = await Promise.all(await manager.resolveHooks([hook], 5));
      const hooks = results[0] as JavaHook[];

      expect(hooks.length).toBe(1);
      expect(hooks[0].retTypeSettings).toBeUndefined();
    });
  });

  // These hook java.lang.Integer.reverse(int), which only the test calls, and revert their hooks.
  describe("registerHooks() / unregisterHooks()", () => {
    // the stack trace limit tells apart which hooks ran; a hook with a stackTraceFilter never matches
    function setup() {
      const calledLimits: number[] = [];
      const recordingStackTrace: PlatformStackTrace = {
        build: (settings: HookSettings) => {
          if (settings.stackTraceFilter.length > 0) throw new FilterMismatchError();
          calledLimits.push(settings.maxStackFrames);
          return { platformStackTrace: [], nativeStackTrace: [] };
        },
      };
      const agent = { addEventToLog: fn() } as unknown as FrookyAgent;
      const manager = new AndroidHookManager(recordingStackTrace, agent);
      const declare = (maxStackFrames: number, hookSettings: Partial<HookSettings> = {}): InputJavaHookNormalized => ({
        ...javaHook("java.lang.Integer", "reverse"),
        hookSettings: { ...DEFAULT_HOOK_SETTINGS, maxStackFrames, ...hookSettings },
      });
      const resolve = async (maxStackFrames: number, hookSettings: Partial<HookSettings> = {}) => {
        const [hooks] = await Promise.all(await manager.resolveHooks([declare(maxStackFrames, hookSettings)], 5));
        return hooks as JavaHook[];
      };
      const reverse = (value: number): number => Java.use("java.lang.Integer").reverse(value);
      const addEventToLog = agent.addEventToLog as unknown as Mock;
      return { manager, declare, resolve, reverse, calledLimits, addEventToLog };
    }

    it("reverts the method to its original implementation", async () => {
      const { manager, resolve, reverse, calledLimits } = setup();
      const hooks = await resolve(1);

      expect(manager.registerHooks(hooks)).toBe(1);
      expect(reverse(1)).toBe(-2147483648);
      expect(calledLimits).toEqual([1]);

      manager.unregisterHooks(hooks);
      expect(hooks[0].method.implementation).toBeNull();
      expect(reverse(1)).toBe(-2147483648);
      expect(calledLimits).toEqual([1]);
    });

    describe("several hooks on the same overload", () => {
      it("records one event per hook for each call, in registration order", async () => {
        const { manager, resolve, reverse, calledLimits, addEventToLog } = setup();
        // resolved separately, as two configs would, so each holds its own Method wrapper
        const first = await resolve(1);
        const second = await resolve(2);

        try {
          expect(manager.registerHooks(first)).toBe(1);
          expect(manager.registerHooks(second)).toBe(1);
          expect(reverse(1)).toBe(-2147483648);
        } finally {
          manager.unregisterHooks(first);
          manager.unregisterHooks(second);
        }

        expect(calledLimits).toEqual([1, 2]);
        expect(addEventToLog.mock.calls.length).toBe(2);
      });

      it("hooks the same overload twice when one resolveHooks() call declares it twice", async () => {
        const { manager, declare, reverse, calledLimits } = setup();
        const [first, second] = (await Promise.all(await manager.resolveHooks([declare(1), declare(2)], 5))) as JavaHook[][];

        expect(first[0].method.handle.toString()).toBe(second[0].method.handle.toString());
        try {
          manager.registerHooks(first);
          manager.registerHooks(second);
          reverse(1);
        } finally {
          manager.unregisterHooks(first);
          manager.unregisterHooks(second);
        }

        expect(calledLimits).toEqual([1, 2]);
        expect(first[0].method.implementation).toBeNull();
      });

      // hooks A, B and C are told apart by their stack trace limits 1, 2 and 3
      for (const [removed, remaining] of [
        ["A", [2, 3]],
        ["B", [1, 3]],
        ["C", [1, 2]],
      ] as const) {
        it(`keeps recording with the other hooks when hook ${removed} of A, B and C is unregistered`, async () => {
          const { manager, resolve, reverse, calledLimits } = setup();
          const hooks = { A: await resolve(1), B: await resolve(2), C: await resolve(3) };
          manager.registerHooks(hooks.A);
          manager.registerHooks(hooks.B);
          manager.registerHooks(hooks.C);

          try {
            manager.unregisterHooks(hooks[removed]);
            expect(reverse(1)).toBe(-2147483648);
          } finally {
            manager.unregisterHooks([...hooks.A, ...hooks.B, ...hooks.C]);
          }

          expect(calledLimits).toEqual([...remaining]);
          expect(hooks.A[0].method.implementation).toBeNull();
        });
      }

      it("keeps recording with the remaining hook until the last one is unregistered", async () => {
        const { manager, resolve, reverse, calledLimits } = setup();
        const first = await resolve(1);
        const second = await resolve(2);
        const third = await resolve(3);
        manager.registerHooks(first);
        manager.registerHooks(second);
        manager.registerHooks(third);

        manager.unregisterHooks(second);
        reverse(1);
        manager.unregisterHooks(first);
        reverse(1);
        manager.unregisterHooks(third);
        reverse(1);

        expect(calledLimits).toEqual([1, 3, 3]);
        expect(first[0].method.implementation).toBeNull();
      });

      it("hooks the overload again after every hook was unregistered", async () => {
        const { manager, resolve, reverse, calledLimits } = setup();
        const first = await resolve(1);
        const second = await resolve(2);
        manager.registerHooks(first);
        manager.unregisterHooks(first);

        try {
          expect(manager.registerHooks(second)).toBe(1);
          reverse(1);
        } finally {
          manager.unregisterHooks(second);
        }

        expect(calledLimits).toEqual([2]);
      });

      it("ignores unregistering a hook that is not registered", async () => {
        const { manager, resolve, reverse, calledLimits } = setup();
        const first = await resolve(1);
        const second = await resolve(2);
        manager.registerHooks(first);

        try {
          manager.unregisterHooks(second);
          manager.unregisterHooks(second);
          reverse(1);
        } finally {
          manager.unregisterHooks(first);
        }

        expect(calledLimits).toEqual([1]);
      });

      it("records nothing once every hook is unregistered", async () => {
        const { manager, resolve, reverse, calledLimits } = setup();
        const first = await resolve(1);
        const second = await resolve(2);
        manager.registerHooks(first);
        manager.registerHooks(second);

        manager.unregisterHooks(first);
        manager.unregisterHooks(second);
        expect(reverse(1)).toBe(-2147483648);

        expect(calledLimits).toEqual([]);
        expect(first[0].method.implementation).toBeNull();
        expect(second[0].method.implementation).toBeNull();
      });

      it("records with the other hooks when one hook's filter does not match", async () => {
        const { manager, resolve, reverse, calledLimits, addEventToLog } = setup();
        const filtered = await resolve(1, { stackTraceFilter: ["^never$"] });
        const unfiltered = await resolve(2);

        try {
          manager.registerHooks(filtered);
          manager.registerHooks(unfiltered);
          expect(reverse(1)).toBe(-2147483648);
        } finally {
          manager.unregisterHooks(filtered);
          manager.unregisterHooks(unfiltered);
        }

        expect(calledLimits).toEqual([2]);
        expect(addEventToLog.mock.calls.length).toBe(1);
      });

      it("runs the original method once per call", async () => {
        // incrementAndGet() has a side effect on the test's own instance, which shows how often it ran
        const agent = { addEventToLog: fn() } as unknown as FrookyAgent;
        const manager = new AndroidHookManager(stackTrace, agent);
        const [first, second] = (await Promise.all(
          await manager.resolveHooks(
            [
              javaHook("java.util.concurrent.atomic.AtomicInteger", "incrementAndGet"),
              javaHook("java.util.concurrent.atomic.AtomicInteger", "incrementAndGet"),
            ],
            5,
          ),
        )) as JavaHook[][];
        const counter = Java.use("java.util.concurrent.atomic.AtomicInteger").$new(0);

        try {
          manager.registerHooks(first);
          manager.registerHooks(second);
          expect(counter.incrementAndGet()).toBe(1);
        } finally {
          manager.unregisterHooks(first);
          manager.unregisterHooks(second);
        }

        expect(counter.get()).toBe(1);
      });

      it("records the same hashCode, the instance's, from every hook", async () => {
        const agent = { addEventToLog: fn() } as unknown as FrookyAgent;
        const manager = new AndroidHookManager(stackTrace, agent);
        const declare = (): InputJavaHookNormalized => ({
          ...javaHook("java.util.concurrent.atomic.AtomicInteger", "incrementAndGet"),
          decoderSettings: { ...DEFAULT_DECODER_SETTINGS, hashCode: true },
        });
        const [first, second] = (await Promise.all(await manager.resolveHooks([declare(), declare()], 5))) as JavaHook[][];
        const counter = Java.use("java.util.concurrent.atomic.AtomicInteger").$new(0);

        try {
          manager.registerHooks(first);
          manager.registerHooks(second);
          counter.incrementAndGet();
        } finally {
          manager.unregisterHooks(first);
          manager.unregisterHooks(second);
        }

        const events = (agent.addEventToLog as unknown as Mock).mock.calls
          .map((call) => call[0] as JavaHookEvent)
          .filter((event) => event.hashCode === formatHashCode(counter.hashCode()));
        expect(events.length).toBe(2);
        expect(events.map((event) => event.fieldType)).toEqual([{ fieldType: "instance" }, { fieldType: "instance" }]);
      });
    });

    it("records no hashCode for a static method", async () => {
      const { manager, reverse, addEventToLog } = setup();
      const hook: InputJavaHookNormalized = {
        ...javaHook("java.lang.Integer", "reverse"),
        decoderSettings: { ...DEFAULT_DECODER_SETTINGS, hashCode: true },
      };
      const [hooks] = (await Promise.all(await manager.resolveHooks([hook], 5))) as JavaHook[][];

      try {
        manager.registerHooks(hooks);
        reverse(1);
      } finally {
        manager.unregisterHooks(hooks);
      }

      const event = addEventToLog.mock.calls[0][0] as JavaHookEvent;
      expect(event.fieldType).toEqual({ fieldType: "static" });
      expect(event.hashCode).toBeUndefined();
    });
  });
});

export {};
