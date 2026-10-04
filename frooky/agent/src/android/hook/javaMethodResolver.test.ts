import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { JavaHookDeclaration } from "../../shared/hook/hookDeclaration";
import { resolveMethodHooks } from "./javaMethodResolver";

function javaHook(method: string, overrides: Partial<JavaHookDeclaration> = {}): JavaHookDeclaration {
  return { javaClass: "java.lang.String", method, hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS, ...overrides };
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

  it("returns null if the method doesn't exist in any of the classes", () => {
    expect(resolveMethodHooks([string()], javaHook("doesNotExist"))).toBeNull();
  });
});
