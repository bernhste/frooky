import Java from "frida-java-bridge";
import { DEFAULT_BASE_DECODER_SETTINGS, DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { JavaHookDeclaration } from "../../shared/hook/hookDeclaration";
import { logger } from "../../shared/logger";
import { resolveMethodHooks } from "./javaMethodResolver";

function javaHook(method: string, overrides: Partial<JavaHookDeclaration> = {}): JavaHookDeclaration {
  return { javaClass: "java.lang.String", method, hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_BASE_DECODER_SETTINGS, ...overrides };
}

describe("resolveMethodHooks()", () => {
  const string = () => Java.use("java.lang.String");

  it("resolves every overload, with params from their argument types", () => {
    const hooks = resolveMethodHooks([string()], javaHook("indexOf"))!;

    expect(hooks.length).toBe(string().indexOf.overloads.length);
    const intOverload = hooks.find((hook) => hook.method.argumentTypes.map((t) => t.className).join(",") === "int");
    expect(intOverload!.params).toEqual([{ type: "int", direction: "in", declaringClass: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS }]);
  });

  it("resolves only the declared overloads and skips those that don't exist", () => {
    const overloads = [
      { params: [{ type: "int", direction: "in" as const, settings: DEFAULT_DECODER_SETTINGS }] },
      { params: [{ type: "java.lang.Thread", direction: "in" as const, settings: DEFAULT_DECODER_SETTINGS }] },
    ];

    const hooks = resolveMethodHooks([string()], javaHook("indexOf", { overloads }))!;

    expect(hooks.length).toBe(1);
    expect(hooks[0].params![0].declaringClass).toBe("java.lang.String");
  });

  it("skips the blocked overloads of a method", () => {
    const javaClass = Java.use("java.lang.Class");
    const hooks = resolveMethodHooks([javaClass], javaHook("forName", { javaClass: "java.lang.Class" }))!;

    const paramTypes = hooks.map((hook) => hook.method.argumentTypes.map((t) => t.className).join(","));
    expect(paramTypes).not.toContain("java.lang.String");
    expect(paramTypes).toContain("java.lang.String,boolean,java.lang.ClassLoader");
    expect(hooks.length).toBe(javaClass.forName.overloads.length - 1);
  });

  it("names the constructors `$init`", () => {
    const stringBuilder = Java.use("java.lang.StringBuilder");
    const hooks = resolveMethodHooks([stringBuilder], javaHook("$init", { javaClass: "java.lang.StringBuilder" }))!;

    expect(hooks.length).toBe(stringBuilder.$init.overloads.length);
    expect(hooks.every((hook) => hook.methodName === "$init")).toBeTruthy();
  });

  it("skips blocked constructors", () => {
    const warnSpy = spyOn(logger, "warn");
    const overloads = [{ params: [{ type: "java.lang.String", direction: "in" as const, settings: DEFAULT_DECODER_SETTINGS }] }];

    const all = resolveMethodHooks([string()], javaHook("$init"));
    const declared = resolveMethodHooks([string()], javaHook("$init", { overloads }));
    warnSpy.mockRestore();

    expect(all).toBeNull();
    expect(declared).toBeNull();
  });

  it("returns null if the method doesn't exist in any of the classes", () => {
    expect(resolveMethodHooks([string()], javaHook("doesNotExist"))).toBeNull();
  });

  it("resolves a '*' pattern to every overload of each matching method", () => {
    const hooks = resolveMethodHooks([string()], javaHook("*ndexOf"))!;

    expect([...new Set(hooks.map((hook) => hook.methodName))].sort()).toEqual(["indexOf", "lastIndexOf"]);
    expect(hooks.length).toBe(string().indexOf.overloads.length + string().lastIndexOf.overloads.length);
  });

  it("resolves the declared overloads of the methods a '*' pattern matches, without warning about the others", () => {
    const warnSpy = spyOn(logger, "warn");
    const overloads = [{ params: [{ type: "int", direction: "in" as const, settings: DEFAULT_DECODER_SETTINGS }] }];

    const hooks = resolveMethodHooks([string()], javaHook("*", { overloads }))!;
    const warnCount = warnSpy.mock.calls.length;
    warnSpy.mockRestore();

    expect(hooks.map((hook) => hook.methodName)).toContain("indexOf");
    expect(hooks.map((hook) => hook.methodName)).toContain("charAt");
    expect(warnCount).toBe(0);
  });

  it("matches a '*' pattern only against the methods the class declares itself", () => {
    expect(resolveMethodHooks([string()], javaHook("wait*"))).toBeNull();
    expect(resolveMethodHooks([string()], javaHook("*"))!.map((hook) => hook.methodName)).not.toContain("$init");
  });

  describe("a method the class inherits", () => {
    const use = (name: string) => Java.use(name);
    const declaration = (javaClass: string, method: string) => javaHook(method, { javaClass });

    it("is resolved as the method of the declaring class, to be recorded for instances of the hooked class only", () => {
      const infoSpy = spyOn(logger, "info");
      const hooks = resolveMethodHooks([use("java.util.Stack")], declaration("java.util.Stack", "addElement"))!;
      const messages = infoSpy.mock.calls.map(([message]) => message as string);
      infoSpy.mockRestore();

      expect(hooks.length).toBe(1);
      expect(hooks[0].method.holder.$className).toBe("java.util.Vector");
      expect(hooks[0].inheritedBy!.$className).toBe("java.util.Stack");
      // the constants of `decoder: constants` are those of the hooked class
      expect(hooks[0].params![0].declaringClass).toBe("java.util.Stack");
      expect(messages).toContain(
        "'java.util.Stack' inherits 'addElement' from 'java.util.Vector'. Only the calls on instances of 'java.util.Stack' are recorded.",
      );
    });

    it("is resolved with its declared overloads", () => {
      const overloads = [{ params: [{ type: "java.lang.Object", name: "element", direction: "in" as const, settings: DEFAULT_DECODER_SETTINGS }] }];

      const hooks = resolveMethodHooks([use("java.util.Stack")], { ...declaration("java.util.Stack", "addElement"), overloads })!;

      expect(hooks.length).toBe(1);
      expect(hooks[0].inheritedBy!.$className).toBe("java.util.Stack");
      expect(hooks[0].params![0]).toEqual({ ...overloads[0].params[0], declaringClass: "java.util.Stack" });
    });

    it("has no `inheritedBy` if the class declares or overrides the method", () => {
      const declared = resolveMethodHooks([use("java.util.Stack")], declaration("java.util.Stack", "push"))!;
      const overridden = resolveMethodHooks([use("java.util.LinkedHashMap")], declaration("java.util.LinkedHashMap", "get"))!;

      expect(declared[0].inheritedBy).toBeUndefined();
      expect(overridden[0].inheritedBy).toBeUndefined();
      expect(overridden[0].method.holder.$className).toBe("java.util.LinkedHashMap");
    });

    it("is hooked once if a class pattern matches the declaring class too", () => {
      const hooks = resolveMethodHooks([use("java.util.Vector"), use("java.util.Stack")], declaration("java.util.*", "addElement"))!;

      expect(hooks.length).toBe(1);
      expect(hooks[0].method.holder.$className).toBe("java.util.Vector");
      expect(hooks[0].inheritedBy).toBeUndefined();
    });

    it("is skipped if the method of the declaring class is blocked", () => {
      const warnSpy = spyOn(logger, "warn");
      const hooks = resolveMethodHooks([use("java.util.Stack")], declaration("java.util.Stack", "getClass"));
      const messages = warnSpy.mock.calls.map(([message]) => message as string);
      warnSpy.mockRestore();

      expect(hooks).toBeNull();
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain("Skipping hook for java method 'getClass' from class 'java.lang.Object':");
    });

    it("warns about a static method, whose calls can't be told apart by an instance", () => {
      const warnSpy = spyOn(logger, "warn");
      const hooks = resolveMethodHooks([use("android.os.HandlerThread")], declaration("android.os.HandlerThread", "currentThread"))!;
      const messages = warnSpy.mock.calls.map(([message]) => message as string);
      warnSpy.mockRestore();

      expect(hooks.length).toBe(1);
      expect(hooks[0].method.holder.$className).toBe("java.lang.Thread");
      expect(hooks[0].inheritedBy).toBeUndefined();
      expect(messages).toEqual([
        "'android.os.HandlerThread' inherits the static method 'currentThread' from 'java.lang.Thread'. A static method has no instance, so the calls through every class are recorded, as calls of 'java.lang.Thread'.",
      ]);
    });
  });
});
