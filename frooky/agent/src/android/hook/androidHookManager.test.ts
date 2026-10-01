import Java from "frida-java-bridge";
import { FrookyAgent } from "../../FrookyAgent";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { InputJavaHookNormalized } from "../../shared/inputParsing/inputJavaHookCollection";
import { HookSettings } from "../../shared/frookySettings";
import { PlatformStackTrace } from "../../shared/platformStackTrace";
import { FilterMismatchError, formatHashCode, sleepMilliseconds } from "../../shared/utils";
import { registerTestClass } from "../decoders/utils/registerTestClass";
import { AndroidHookManager } from "./androidHookManager";
import { JavaHook } from "./javaHook";
import { JavaHookEvent } from "./javaHookEvent";

// resolveHooks() installs nothing, so it can run against always-loaded classes like java.lang.String
const stackTrace: PlatformStackTrace = { build: () => ({ platformStackTrace: [], nativeStackTrace: [] }) };
const frookyAgent = {} as FrookyAgent;

// true if `promise` hasn't settled within 100 ms
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([promise.then(() => false), sleepMilliseconds(100).then(() => true)]);
}

function identityHashCode(object: Java.Wrapper): number {
  return Java.use("java.lang.System").identityHashCode(object);
}

function javaHook(javaClass: string, method: string): InputJavaHookNormalized {
  return { javaClass, method, hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS };
}

describe("AndroidHookManager", () => {
  describe("resolveHooks()", () => {
    it("resolves an exact javaClass and hooks all overloads of the method", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      const results = await Promise.all(await manager.resolveHooks([javaHook("java.lang.String", "length")]));

      expect(results.length).toBe(1);
      const hooks = results[0] as JavaHook[];
      expect(hooks).not.toBeNull();
      expect(hooks.length).toBeGreaterThan(0);
      expect(hooks.every((hook) => hook.methodName === "length")).toBeTruthy();
    });

    it("hooks every overload of a method that has more than one", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      const results = await Promise.all(await manager.resolveHooks([javaHook("java.lang.String", "indexOf")]));

      const hooks = results[0] as JavaHook[];
      expect(hooks).not.toBeNull();
      expect(hooks.length).toBeGreaterThan(1);
      expect(hooks.every((hook) => hook.methodName === "indexOf")).toBeTruthy();
    });

    it("keeps waiting for a javaClass that no class loader has", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      const [result] = await manager.resolveHooks([javaHook("com.frooky.test.DoesNotExist", "foo")]);

      expect(await isPending(result)).toBe(true);
    });

    it("installs the hooks of a class in a class loader created later while the class loader is created", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);
      const registerHooks = spyOn(manager, "registerHooks");
      const javaClass = `com.frooky.test.LateClass${Date.now()}`;

      const [result] = await manager.resolveHooks([javaHook(javaClass, "greet")]);
      expect(registerHooks).not.toHaveBeenCalled();
      // in a new DexClassLoader, which Java.use() doesn't search
      registerTestClass({ name: javaClass, methods: { greet: { returnType: "java.lang.String", argumentTypes: [], implementation: () => "hi" } } });

      // no await since registerTestClass(): the hook was installed while its class loader was created
      expect(registerHooks).toHaveBeenCalledTimes(1);
      const hooks = (await result)!;
      expect(hooks[0].method.holder.$className).toBe(javaClass);
      expect(manager.registerHooks(hooks)).toBe(1);
      manager.unregisterHooks(hooks);
      registerHooks.mockRestore();
    });

    it("installs the hooks of a wildcard match in a class loader created later while the class loader is created", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);
      const registerHooks = spyOn(manager, "registerHooks");
      const javaPackage = `com.frooky.test.late${Date.now()}`;

      const [result] = await manager.resolveHooks([javaHook(`${javaPackage}.*`, "greet")]);
      expect(registerHooks).not.toHaveBeenCalled();
      registerTestClass({
        name: `${javaPackage}.LateClass`,
        methods: { greet: { returnType: "java.lang.String", argumentTypes: [], implementation: () => "hi" } },
      });

      // no await since registerTestClass(): the hook was installed while its class loader was created
      expect(registerHooks).toHaveBeenCalledTimes(1);
      const hooks = (await result)!;
      expect(hooks.map((hook) => hook.method.holder.$className)).toEqual([`${javaPackage}.LateClass`]);
      manager.unregisterHooks(hooks);
      registerHooks.mockRestore();
    });

    it("finds a class with `classLoader` only in instances of that class loader, when one of them loads it", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);
      const registerHooks = spyOn(manager, "registerHooks");
      const suffix = Date.now();
      const target = registerTestClass({
        name: `com.frooky.test.PluginClass${suffix}`,
        methods: { greet: { returnType: "java.lang.String", argumentTypes: [], implementation: () => "hi" } },
      });
      // a custom class loader that doesn't extend BaseDexClassLoader and returns the plugin class
      const pluginLoader = registerTestClass({
        name: `com.frooky.test.PluginLoader${suffix}`,
        superClass: Java.use("java.lang.ClassLoader"),
        methods: {
          loadClass: [
            {
              returnType: "java.lang.Class",
              argumentTypes: ["java.lang.String"],
              implementation: (name: string) => (name === target.$className ? target.class : null),
            },
          ],
        },
      });

      const [result] = await manager.resolveHooks([{ ...javaHook(target.$className, "greet"), classLoader: pluginLoader.$className }]);
      // the class exists in its own class loader, but no instance of the custom class loader loaded it yet
      expect(await isPending(result)).toBe(true);
      expect(registerHooks).not.toHaveBeenCalled();
      pluginLoader.$new().loadClass(target.$className);

      // no await since loadClass(): the hook was installed before loadClass() returned the class
      expect(registerHooks).toHaveBeenCalledTimes(1);
      const hooks = (await result)!;
      expect(hooks[0].method.holder.$className).toBe(target.$className);
      manager.unregisterHooks(hooks);
      registerHooks.mockRestore();
    });

    it("returns null when the method does not exist on an otherwise resolved class", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      const results = await Promise.all(await manager.resolveHooks([javaHook("java.lang.String", "thisMethodDoesNotExist")]));

      expect(results).toEqual([null]);
    });

    it("resolves a wildcard javaClass to every matching class", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      // CRC32 and Adler32 both declare getValue(), and '*' matches one segment only: it doesn't reach
      // classes in subpackages. Matches are installed right away, so not on methods the app calls all the time.
      const results = await Promise.all(await manager.resolveHooks([javaHook("java.util.zip.*", "getValue")]));

      const hooks = results[0] as JavaHook[];
      expect(hooks).not.toBeNull();
      const classes = hooks.map((hook) => hook.method.holder.$className);
      expect(classes.length).toBeGreaterThan(0);
      expect(classes.every((name) => /^java\.util\.zip\.[^.]+$/.test(name))).toBe(true);
      manager.unregisterHooks(hooks);
    });

    it("keeps waiting for a wildcard javaClass that matches no class", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      const [result] = await manager.resolveHooks([javaHook("com.frooky.test.*.DoesNotExist", "foo")]);

      expect(await isPending(result)).toBe(true);
    });

    it("processes hooks for different classes independently", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);

      const results = await Promise.all(
        await manager.resolveHooks([javaHook("java.lang.String", "length"), javaHook("java.lang.Object", "hashCode")]),
      );

      expect(results.length).toBe(2);
      expect(results.every((hooks) => hooks !== null && hooks.length > 0)).toBeTruthy();
    });

    it("carries an overload's retType decoder settings onto the resolved JavaHook", async () => {
      const manager = new AndroidHookManager(stackTrace, frookyAgent);
      const retTypeSettings = { ...DEFAULT_DECODER_SETTINGS, decoder: "hashCode" as const };
      const hook: InputJavaHookNormalized = {
        javaClass: "java.lang.String",
        method: "indexOf",
        hookSettings: DEFAULT_HOOK_SETTINGS,
        decoderSettings: DEFAULT_DECODER_SETTINGS,
        overloads: [{ params: ["int"], retType: retTypeSettings }],
      };

      const results = await Promise.all(await manager.resolveHooks([hook]));
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

      const results = await Promise.all(await manager.resolveHooks([hook]));
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
        const [hooks] = await Promise.all(await manager.resolveHooks([declare(maxStackFrames, hookSettings)]));
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
        const [first, second] = (await Promise.all(await manager.resolveHooks([declare(1), declare(2)]))) as JavaHook[][];

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
          await manager.resolveHooks([
            javaHook("java.util.concurrent.atomic.AtomicInteger", "incrementAndGet"),
            javaHook("java.util.concurrent.atomic.AtomicInteger", "incrementAndGet"),
          ]),
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
        const declare = (): InputJavaHookNormalized => javaHook("java.util.concurrent.atomic.AtomicInteger", "incrementAndGet");
        const [first, second] = (await Promise.all(await manager.resolveHooks([declare(), declare()]))) as JavaHook[][];
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
          .filter((event) => event.hashCode === formatHashCode(identityHashCode(counter)));
        expect(events.length).toBe(2);
        expect(events.map((event) => event.fieldType)).toEqual([{ fieldType: "instance" }, { fieldType: "instance" }]);
      });
    });

    it("records the instance's identity hash code, which stays the same while a content-based hashCode() changes", async () => {
      const agent = { addEventToLog: fn() } as unknown as FrookyAgent;
      const manager = new AndroidHookManager(stackTrace, agent);
      const [hooks] = (await Promise.all(await manager.resolveHooks([javaHook("java.util.BitSet", "set")]))) as JavaHook[][];
      const bits = Java.use("java.util.BitSet").$new();
      const expected = formatHashCode(identityHashCode(bits));

      try {
        manager.registerHooks(hooks);
        bits.set(1);
        bits.set(2);
      } finally {
        manager.unregisterHooks(hooks);
      }

      const events = (agent.addEventToLog as unknown as Mock).mock.calls
        .map((call) => call[0] as JavaHookEvent)
        .filter((event) => event.hashCode === expected);
      expect(events.length).toBe(2);
      expect(formatHashCode(bits.hashCode())).not.toBe(expected);
    });

    it("records no hashCode for a static method", async () => {
      const { manager, reverse, addEventToLog } = setup();
      const [hooks] = (await Promise.all(await manager.resolveHooks([javaHook("java.lang.Integer", "reverse")]))) as JavaHook[][];

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

  describe("calls made by hook code", () => {
    function eventsOf(agent: FrookyAgent, method: string, instance?: Java.Wrapper): JavaHookEvent[] {
      const hashCode = instance ? formatHashCode(identityHashCode(instance)) : undefined;
      return (agent.addEventToLog as unknown as Mock).mock.calls
        .map((call) => call[0] as JavaHookEvent)
        .filter((event) => event.method === method && (hashCode === undefined || event.hashCode === hashCode));
    }

    it("runs a hooked method that the hook's own code calls without its hooks", async () => {
      const reverse = (value: number): number => Java.use("java.lang.Integer").reverse(value);
      const innerResults: number[] = [];
      // stands in for a decoder or a stack trace that calls the hooked method
      const reentrantStackTrace: PlatformStackTrace = {
        build: () => {
          innerResults.push(reverse(5));
          return { platformStackTrace: [], nativeStackTrace: [] };
        },
      };
      const agent = { addEventToLog: fn() } as unknown as FrookyAgent;
      const manager = new AndroidHookManager(reentrantStackTrace, agent);
      const [hooks] = (await Promise.all(await manager.resolveHooks([javaHook("java.lang.Integer", "reverse")]))) as JavaHook[][];

      try {
        manager.registerHooks(hooks);
        expect(reverse(1)).toBe(-2147483648);
      } finally {
        manager.unregisterHooks(hooks);
      }

      expect(innerResults).toEqual([-1610612736]);
      expect(eventsOf(agent, "reverse").length).toBe(1);
    });

    it("records the hooked methods that the original method calls", async () => {
      const Nested = registerTestClass({
        name: `frooky.test.NestedCalls${Date.now()}`,
        methods: {
          inner: { returnType: "int", argumentTypes: ["int"], implementation: (n: number) => n + 1 },
          outer: {
            returnType: "int",
            argumentTypes: ["int"],
            implementation: function (this: Java.Wrapper, n: number) {
              return this.inner(n) * 2;
            },
          },
        },
      });
      const agent = { addEventToLog: fn() } as unknown as FrookyAgent;
      const manager = new AndroidHookManager(stackTrace, agent);
      const hooks = (await Promise.all(
        await manager.resolveHooks([javaHook(Nested.$className, "outer"), javaHook(Nested.$className, "inner")]),
      )) as JavaHook[][];
      const nested = Nested.$new();

      try {
        hooks.forEach((h) => manager.registerHooks(h));
        expect(nested.outer(1)).toBe(4);
      } finally {
        hooks.forEach((h) => manager.unregisterHooks(h));
      }

      expect(eventsOf(agent, "outer", nested).length).toBe(1);
      expect(eventsOf(agent, "inner", nested).length).toBe(1);
    });

    // frida-java-bridge and the decoders call these methods while they handle a hook
    it("hooks ArrayList.add(), StringBuilder.append() and StringBuilder.toString() without recursing", async () => {
      const agent = { addEventToLog: fn() } as unknown as FrookyAgent;
      const manager = new AndroidHookManager(stackTrace, agent);
      const hooks = (await Promise.all(
        await manager.resolveHooks([
          javaHook("java.util.ArrayList", "add"),
          javaHook("java.lang.StringBuilder", "append"),
          javaHook("java.lang.StringBuilder", "toString"),
        ]),
      )) as JavaHook[][];
      const list = Java.use("java.util.ArrayList").$new();
      const builder = Java.use("java.lang.StringBuilder").$new();

      try {
        hooks.forEach((h) => manager.registerHooks(h));
        list.add(Java.use("java.lang.String").$new("item"));
        builder.append("text");
        expect(builder.toString()).toBe("text");
      } finally {
        hooks.forEach((h) => manager.unregisterHooks(h));
      }

      // add(Object) and append(String) also call other overloads of themselves, which are recorded too
      expect(list.size()).toBe(1);
      expect(eventsOf(agent, "add", list).map((event) => event.argsIn!.length)).toContain(1);
      expect(eventsOf(agent, "append", builder).map((event) => event.argsIn![0].type)).toContain("java.lang.String");
      expect(eventsOf(agent, "toString", builder).length).toBe(1);
    });

    // a new class loader's ClassFactory converts values with types that haven't been used yet
    it("hooks StringBuilder.toString() of a new ClassFactory without recursing", () => {
      const parent = Java.use("java.lang.ClassLoader").getSystemClassLoader();
      const loader = Java.use("dalvik.system.PathClassLoader").$new("", parent);
      const factory = Java.ClassFactory.get(Java.retain(loader));
      const StringBuilder = factory.use("java.lang.StringBuilder");
      const hook: JavaHook = {
        methodName: "toString",
        method: (StringBuilder.toString as unknown as Java.MethodDispatcher).overload(),
        params: [],
        hookSettings: DEFAULT_HOOK_SETTINGS,
        decoderSettings: DEFAULT_DECODER_SETTINGS,
      };
      const agent = { addEventToLog: fn() } as unknown as FrookyAgent;
      const manager = new AndroidHookManager(stackTrace, agent);
      const builder = StringBuilder.$new("text");

      try {
        manager.registerHooks([hook]);
        expect(builder.toString()).toBe("text");
      } finally {
        manager.unregisterHooks([hook]);
      }

      expect(eventsOf(agent, "toString", builder).length).toBe(1);
    });
  });
});

export {};
