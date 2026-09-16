import { FrookyAgent } from "../../FrookyAgent";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { InputJavaHookNormalized } from "../../shared/inputParsing/inputJavaHookCollection";
import { PlatformStackTrace } from "../../shared/platformStackTrace";
import { AndroidHookManager } from "./androidHookManager";
import { JavaHook } from "./javaHook";

// resolveHooks() only resolves method/overload metadata, it never installs an implementation
// (that's registerHooks()'s job), so it's safe to run against real, always-loaded JVM bootstrap
// classes (java.lang.String, java.lang.Object) without risking side effects on the host process.
const stackTrace: PlatformStackTrace = { build: () => [] };
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

      // timeout 0 makes pollUntilResolved reject on the first check instead of retrying for a
      // full poll cycle - this test only cares that a failed resolution surfaces as null, not
      // how many attempts were made, and enumerateLoadedClassesSync()/repeated polling against a
      // real device is slow enough to noticeably drag out the suite otherwise.
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

      // timeout 0, see the "javaClass does not exist" test above for why - this one is
      // otherwise even slower, since every poll attempt enumerates all loaded classes.
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
});
