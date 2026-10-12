import { DEFAULT_BASE_DECODER_SETTINGS, DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { normalizeInputParams } from "../../shared/inputParsing/inputDecodableTypes";
import { InputJavaHookCollection, InputJavaHookDetails } from "../../shared/inputParsing/inputJavaHookCollection";
import { InputNativeHookCollection } from "../../shared/inputParsing/inputNativeHookCollection";
import { logger } from "../../shared/logger";
import { AndroidHookValidator, validateJavaClassName } from "./androidHookValidator";

const defaultSettings: FrookySettings = {
  hookSettings: { ...DEFAULT_HOOK_SETTINGS },
  decoderSettings: { ...DEFAULT_BASE_DECODER_SETTINGS },
};

describe("AndroidHookValidator", () => {
  const validator = new AndroidHookValidator();

  describe("getPlatformHookCollections()", () => {
    it("returns an empty array for an empty hookCollection list", () => {
      const config: InputFrookyConfig = { hookCollections: [] };
      expect(validator.getPlatformHookCollections(config)).toEqual([]);
    });

    it("returns only the java hook collections from a mixed hookCollection list, preserving order", () => {
      const javaCollectionA: InputJavaHookCollection = { javaClass: "com.example.A", hooks: [] };
      const nativeCollection: InputNativeHookCollection = { module: "libc.so", hooks: [] };
      const javaCollectionB: InputJavaHookCollection = { javaClass: "com.example.B", hooks: [] };
      const config: InputFrookyConfig = {
        hookCollections: [javaCollectionA, nativeCollection, javaCollectionB] as unknown as InputJavaHookCollection[],
      };

      expect(validator.getPlatformHookCollections(config)).toEqual([javaCollectionA, javaCollectionB]);
    });

    it("returns an empty array when there are no java hook collections", () => {
      const nativeCollection: InputNativeHookCollection = { module: "libc.so", hooks: [] };
      const config: InputFrookyConfig = { hookCollections: [nativeCollection] as unknown as InputJavaHookCollection[] };

      expect(validator.getPlatformHookCollections(config)).toEqual([]);
    });
  });

  describe("validateAndNormalizeHooks()", () => {
    let warnSpy: Mock;

    beforeEach(() => {
      warnSpy = spyOn(logger, "warn");
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("returns an empty array when the config has no java hook collections", () => {
      const config: InputFrookyConfig = { hookCollections: [] };
      expect(validator.validateAndNormalizeHooks(config, defaultSettings)).toEqual([]);
    });

    it("normalizes a plain method-name hook into a full JavaHookDeclaration", () => {
      const javaCollection: InputJavaHookCollection = { javaClass: "com.example.Foo", hooks: ["bar"] };
      const config: InputFrookyConfig = { hookCollections: [javaCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result).toEqual([
        { javaClass: "com.example.Foo", method: "bar", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_BASE_DECODER_SETTINGS },
      ]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    for (const [kind, hooks] of [
      ["a string", "bar"],
      ["missing", undefined],
    ]) {
      it(`skips a collection whose hooks are ${kind}`, () => {
        const javaCollection = { javaClass: "com.example.Foo", hooks } as unknown as InputJavaHookCollection;
        const otherCollection: InputJavaHookCollection = { javaClass: "com.example.Bar", hooks: ["baz"] };
        const config: InputFrookyConfig = { hookCollections: [javaCollection, otherCollection] };

        const result = validator.validateAndNormalizeHooks(config, defaultSettings);

        expect(result.map((hook) => hook.method)).toEqual(["baz"]);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0][0])).toContain("Skipping the hook collection for class 'com.example.Foo': 'hooks' must be a list");
      });
    }

    it("collects hooks from multiple java hook collections, ignoring non-java hook collections", () => {
      const javaCollectionA: InputJavaHookCollection = { javaClass: "com.example.A", hooks: ["foo"] };
      const nativeCollection: InputNativeHookCollection = { module: "libc.so", hooks: ["bar"] };
      const javaCollectionB: InputJavaHookCollection = { javaClass: "com.example.B", hooks: ["baz"] };
      const config: InputFrookyConfig = {
        hookCollections: [javaCollectionA, nativeCollection, javaCollectionB] as unknown as InputJavaHookCollection[],
      };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["foo", "baz"]);
    });

    it("skips a hook that fails schema validation, warns about it, and still keeps the valid hooks", () => {
      const invalidHook = { javaClass: "com.example.Foo", method: 123 as unknown as string };
      const javaCollection: InputJavaHookCollection = {
        javaClass: "com.example.Foo",
        hooks: ["validMethod", invalidHook],
      };
      const config: InputFrookyConfig = { hookCollections: [javaCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["validMethod"]);
      expect(warnSpy).toHaveBeenCalled();
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("Skipping hook for java method '123' from class 'com.example.Foo' due to an invalid declaration:");
    });

    it("skips a hook whose overload param declaration is in an unrecognized format, without aborting the rest of the collection", () => {
      // a number is no valid param and makes normalization throw a plain Error, not a ZodError
      const invalidParamHook = {
        javaClass: "com.example.Foo",
        method: "bad",
        overloads: [{ params: [123 as unknown as string] }],
      };
      const javaCollection: InputJavaHookCollection = {
        javaClass: "com.example.Foo",
        hooks: ["foo", invalidParamHook, "baz"],
      };
      const config: InputFrookyConfig = { hookCollections: [javaCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["foo", "baz"]);
      expect(warnSpy).toHaveBeenCalled();
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("Skipping hook for java method 'bad' from class 'com.example.Foo' due to an invalid declaration:");
    });

    it("skips a hook with a native decoder, naming the Java decoders", () => {
      const javaCollection: InputJavaHookCollection = {
        javaClass: "com.example.Foo",
        hooks: ["foo", { method: "bar", overloads: [{ params: [["int", "fd", { decoder: "fd" }]] }] }],
      };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [javaCollection] }, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["foo"]);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("decoder 'fd' is no Java decoder. The Java decoders are: string, base64, hex, hashCode,");
    });

    it("skips a hook collection and a hook with an unknown property or the settings of a single parameter", () => {
      const collections = [
        { javaClass: "com.example.Foo", decoderSettings: { maxItems: 3, argFilter: ["^a"] }, hooks: ["skippedA"] },
        { javaClass: "com.example.Foo", hookSetings: {}, hooks: ["skippedB"] },
        {
          javaClass: "com.example.Foo",
          hooks: [
            { method: "bar", decoderSettings: { maxItems: 3, decoderOptions: { constants: { A: 1 } } } },
            ["baz", { decoder: "hashCode", argFilter: ["^b"] }],
            { method: "qux", overloads: [{ params: ["int"], retTyp: { maxDepth: 2 } }] },
            "ok",
          ],
        },
      ] as unknown as InputJavaHookCollection[];

      const hooks = validator.validateAndNormalizeHooks({ hookCollections: collections }, defaultSettings);

      expect(hooks.map((hook) => hook.method)).toEqual(["ok"]);
      const messages = warnSpy.mock.calls.map(([message]) => message as string);
      expect(messages).toContain(
        "Skipping the hook collection for class 'com.example.Foo': The hook collection contains unknown properties: decoderSettings.argFilter",
      );
      expect(messages).toContain(
        "Skipping the hook collection for class 'com.example.Foo': The hook collection contains unknown properties: hookSetings",
      );
      const skipped = (method: string, properties: string) =>
        `Skipping hook for java method '${method}' from class 'com.example.Foo' due to an invalid declaration:\nThe hook contains unknown properties: ${properties}`;
      expect(messages).toContain(skipped("bar", "decoderSettings.decoderOptions"));
      expect(messages).toContain(skipped("baz", "[1].argFilter"));
      expect(messages).toContain(skipped("qux", "overloads[0].retTyp"));
    });

    it("accepts decoderOptions.constants for the constants and bitmask decoders, also with the decoder of the hook", () => {
      const javaCollection: InputJavaHookCollection = {
        javaClass: "com.example.Foo",
        hooks: [
          { method: "a", overloads: [{ params: [["int", "mode", { decoder: "constants", decoderOptions: { constants: { A: 1 } } }]] }] },
          {
            method: "b",
            decoderSettings: { decoder: "bitmask" },
            overloads: [
              { params: [["int", "flags", { decoderOptions: { constants: { B: 2 } } }]], returns: { decoderOptions: { constants: { C: 4 } } } },
            ],
          },
        ],
      };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [javaCollection] }, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["a", "b"]);
      expect(result[1].overloads?.[0].params[0].settings).toEqual({
        ...DEFAULT_DECODER_SETTINGS,
        decoder: "bitmask",
        decoderOptions: { constants: { B: 2 } },
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("skips a hook collection whose javaClass or classLoader is no Java class name", () => {
      const names = ["", " ", "com.example.Foo.", ".com.example.Foo", "com..Foo", "com/example/Foo", "Lcom/example/Foo;", "[B", " com.example.Foo"];
      const collections: InputJavaHookCollection[] = [
        ...names.map((javaClass) => ({ javaClass, hooks: ["skipped"] })),
        { javaClass: "com.example.Foo", classLoader: "com/example/Loader", hooks: ["skipped"] },
        { javaClass: "com.example.Foo$Inner", classLoader: "com.example.Loader", hooks: ["inner"] },
        { javaClass: "com.example.**", hooks: ["pattern"] },
        { javaClass: "a.b", hooks: ["obfuscated"] },
      ];

      const hooks = validator.validateAndNormalizeHooks({ hookCollections: collections }, defaultSettings);

      expect(hooks.map((hook) => hook.method)).toEqual(["inner", "pattern", "obfuscated"]);
      const messages = warnSpy.mock.calls.map(([message]) => message as string);
      expect(messages.length).toBe(names.length + 1);
      expect(messages).toContain(
        "Skipping the hook collection for class '': 'javaClass' must be a fully qualified Java class name with dots, e.g. 'android.content.Intent', but is ''.",
      );
      expect(messages).toContain(
        "Skipping the hook collection for class 'Lcom/example/Foo;': 'javaClass' must be a fully qualified Java class name with dots, e.g. 'android.content.Intent', but is 'Lcom/example/Foo;'. Did you mean 'com.example.Foo'?",
      );
      expect(messages).toContain(
        "Skipping the hook collection for class 'com.example.Foo': 'classLoader' must be a fully qualified Java class name with dots, e.g. 'android.content.Intent', but is 'com/example/Loader'. Did you mean 'com.example.Loader'?",
      );
    });

    it("skips a hook whose decoderOptions.class is no Java class name", () => {
      const javaCollection: InputJavaHookCollection = {
        javaClass: "com.example.Foo",
        hooks: [
          { method: "a", overloads: [{ params: [["int", "mode", { decoder: "constants", decoderOptions: { class: "" } }]] }] },
          { method: "b", overloads: [{ params: ["int"], returns: { decoder: "bitmask", decoderOptions: { class: "javax/crypto/Cipher" } } }] },
          "ok",
        ],
      };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [javaCollection] }, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["ok"]);
      const messages = warnSpy.mock.calls.map(([message]) => message as string);
      expect(messages.length).toBe(2);
      expect(messages[0]).toContain("Skipping hook for java method 'a' from class 'com.example.Foo' due to an invalid declaration:");
      expect(messages[0]).toContain("overloads[0].params[0][2].decoderOptions.class");
      expect(messages[1]).toContain("overloads[0].returns.decoderOptions.class");
    });

    it("accepts decoderOptions.class and decoderOptions.fields, and skips a hook that combines them with a map", () => {
      const javaCollection: InputJavaHookCollection = {
        javaClass: "com.example.Foo",
        hooks: [
          {
            method: "a",
            overloads: [{ params: [["int", "mode", { decoder: "constants", decoderOptions: { class: "javax.crypto.Cipher", fields: "*_MODE" } }]] }],
          },
          { method: "b", overloads: [{ params: [["int", "flags", { decoder: "bitmask", decoderOptions: { fields: "FLAG_*" } }]] }] },
          {
            method: "c",
            overloads: [{ params: [["int", "mode", { decoder: "constants", decoderOptions: { constants: { A: 1 }, fields: "*_MODE" } }]] }],
          },
        ],
      };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [javaCollection] }, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["a", "b"]);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain(
        "decoderOptions of 'mode': 'constants' can't be combined with 'class' or 'fields'. Use either the map or the fields of a class.",
      );
    });

    it("skips a hook with decoderOptions its decoder doesn't accept", () => {
      const javaCollection: InputJavaHookCollection = {
        javaClass: "com.example.Foo",
        hooks: [
          "ok",
          { method: "a", overloads: [{ params: [["[B", "data", { decoder: "base64", decoderOptions: { constants: { A: 1 } } }]] }] },
          { method: "b", overloads: [{ params: ["int"], returns: { decoderOptions: { constants: { A: 1 } } } }] },
        ],
      };

      const result = validator.validateAndNormalizeHooks({ hookCollections: [javaCollection] }, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["ok"]);
      const messages = warnSpy.mock.calls.map(([message]) => message as string);
      expect(messages[0]).toContain("decoderOptions of 'data': decoder 'base64' doesn't accept 'constants'. It accepts no decoderOptions.");
      expect(messages[1]).toContain(
        "decoderOptions of 'return value': the decoder of its type doesn't accept 'constants'. It accepts no decoderOptions.",
      );
    });

    it("still validates the remaining java hook collections after one collection contained an unnormalizable hook", () => {
      const brokenCollection: InputJavaHookCollection = {
        javaClass: "com.example.Foo",
        hooks: [{ method: "bad", overloads: [{ params: [123 as unknown as string] }] }],
      };
      const healthyCollection: InputJavaHookCollection = { javaClass: "com.example.Bar", hooks: ["baz"] };
      const config: InputFrookyConfig = { hookCollections: [brokenCollection, healthyCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["baz"]);
    });

    it("processes every hook independently, warning once per invalid hook without aborting the collection", () => {
      const invalidHookA = { javaClass: "com.example.Foo", method: 1 as unknown as string };
      const invalidHookB = { javaClass: "com.example.Foo", method: 2 as unknown as string };
      const javaCollection: InputJavaHookCollection = {
        javaClass: "com.example.Foo",
        hooks: [invalidHookA, "validMethod", invalidHookB],
      };
      const config: InputFrookyConfig = { hookCollections: [javaCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result.map((hook) => hook.method)).toEqual(["validMethod"]);
      expect(warnSpy.mock.calls.length).toBe(2);
    });

    it("warns and disables early setting on Java hooks", () => {
      const javaCollection: InputJavaHookCollection = {
        javaClass: "com.example.Foo",
        hookSettings: { early: true },
        hooks: ["bar"],
      };
      const config: InputFrookyConfig = { hookCollections: [javaCollection] };

      const result = validator.validateAndNormalizeHooks(config, defaultSettings);

      expect(result[0].hookSettings?.early).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("Early hooking ('early: true') is not supported for Java method 'bar' from class 'com.example.Foo'");
    });

    describe("blocked methods", () => {
      const warnings = () => warnSpy.mock.calls.map((call) => String(call[0]));
      const hooksOf = (javaClass: string, hooks: InputJavaHookCollection["hooks"]) =>
        validator.validateAndNormalizeHooks({ hookCollections: [{ javaClass, hooks }] }, defaultSettings);

      it("skips a method the hook breaks the app on", () => {
        expect(hooksOf("java.lang.String", ["$init", "equals"]).map((hook) => hook.method)).toEqual(["equals"]);
        expect(warnings().length).toBe(1);
        expect(warnings()[0]).toContain("Skipping hook for java method '$init' from class 'java.lang.String': ART runs a String constructor");
        expect(warnings()[0]).toContain("Hook the newStringFrom* methods of java.lang.StringFactory instead.");
      });

      it("skips java.lang.Object.$init", () => {
        expect(hooksOf("java.lang.Object", ["$init"]).map((hook) => hook.method)).toEqual([]);
        expect(warnings().length).toBe(1);
        expect(warnings()[0]).toContain("Skipping hook for java method '$init' from class 'java.lang.Object'");
      });

      it("matches the class by its full name", () => {
        expect(hooksOf("com.example.String", ["$init"]).map((hook) => hook.method)).toEqual(["$init"]);
      });

      it("keeps the overloads of a method that aren't blocked", () => {
        const [hook] = hooksOf("java.lang.Class", [
          { method: "forName", overloads: [{ params: ["java.lang.String"] }, { params: ["java.lang.String", "boolean", "java.lang.ClassLoader"] }] },
        ]);

        expect(hook.overloads!.map((overload) => overload.params.map((param) => param.type))).toEqual([
          ["java.lang.String", "boolean", "java.lang.ClassLoader"],
        ]);
        expect(warnings()).toEqual([
          "Skipping hook for java method 'forName(java.lang.String)' from class 'java.lang.Class': it uses its caller's class loader, which the hook turns into the boot class loader, so it doesn't find the app's classes.",
        ]);
      });

      it("skips a hook whose declared overloads are all blocked", () => {
        expect(hooksOf("java.lang.Class", [{ method: "forName", overloads: [{ params: ["java.lang.String"] }] }])).toEqual([]);
      });

      it("leaves a hook on every overload of a partly blocked method to the resolver", () => {
        expect(hooksOf("java.lang.Class", ["forName"]).map((hook) => hook.method)).toEqual(["forName"]);
        expect(warnings()).toEqual([]);
      });
    });
  });
});

describe("validateJavaClassName()", () => {
  it("accepts class names, nested classes and patterns", () => {
    for (const name of [
      "Foo",
      "a.b",
      "android.content.Intent",
      "com.example.Outer$Inner",
      "org.owasp.*.HttpClient",
      "android.**",
      "*",
      "kotlin.jvm.internal.Ref$ObjectRef",
    ]) {
      expect(() => validateJavaClassName(name, "javaClass")).not.toThrow();
    }
  });

  it("only suggests a name that is valid", () => {
    expect(() => validateJavaClassName("com/example/", "javaClass")).toThrow(
      "'javaClass' must be a fully qualified Java class name with dots, e.g. 'android.content.Intent', but is 'com/example/'.",
    );
  });
});
