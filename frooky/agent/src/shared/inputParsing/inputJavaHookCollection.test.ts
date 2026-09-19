import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings } from "../frookySettings";
import { normalizeInputParams } from "./inputDecodableTypes";
import { InputJavaHookCollection, InputJavaHookNormalized, isJavaHookScope, normalizeJavaHookCollection } from "./inputJavaHookCollection";

describe("inputJavaHookCollection", () => {
  describe("isJavaHookScope()", () => {
    it("returns true for a valid InputJavaHookCollection", () => {
      const javaHookCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.Foo", hooks: [] };
      expect(isJavaHookScope(javaHookCollection)).toBeTruthy();
    });

    it("returns false for an objc hook group (no javaClass property)", () => {
      expect(isJavaHookScope({ objcClass: "NSString", hooks: [] })).toBeFalsy();
    });

    it("returns false for a native hook group (no javaClass property)", () => {
      expect(isJavaHookScope({ type: "native", module: "libc.so", hooks: [] })).toBeFalsy();
    });

    it("returns true when javaClass is the only property present", () => {
      expect(isJavaHookScope({ javaClass: "com.example.Foo" })).toBeTruthy();
    });

    it("returns true even when javaClass is an empty string, since only key presence is checked", () => {
      expect(isJavaHookScope({ javaClass: "" })).toBeTruthy();
    });

    it("returns false for an empty object", () => {
      expect(isJavaHookScope({})).toBeFalsy();
    });
  });

  describe("normalizeJavaHookCollection()", () => {
    const defaultSettings: FrookySettings = {
      hookSettings: { ...DEFAULT_HOOK_SETTINGS },
      decoderSettings: { ...DEFAULT_DECODER_SETTINGS },
    };

    describe("settings merging", () => {
      it("falls back to the default hook and decoder settings when nothing overrides them", () => {
        const hookCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.Foo", hooks: [] };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect(result.hookSettings).toEqual(DEFAULT_HOOK_SETTINGS);
        expect(result.decoderSettings).toEqual(DEFAULT_DECODER_SETTINGS);
      });

      it("lets the frookySettings passed in override the hard-coded defaults", () => {
        const hookCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.Foo", hooks: [] };
        const settings: FrookySettings = {
          hookSettings: { ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 5 },
          decoderSettings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 42 },
        };

        const result = normalizeJavaHookCollection(hookCollection, settings);

        expect(result.hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 5 });
        expect(result.decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 42 });
      });

      it("gives the hook group's own hookSettings/decoderSettings the highest precedence", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hooks: [],
          hookSettings: { maxStackFrames: 99 },
          decoderSettings: { maxDepth: 7 },
        };
        const settings: FrookySettings = {
          hookSettings: { ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 5 },
          decoderSettings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 42 },
        };

        const result = normalizeJavaHookCollection(hookCollection, settings);

        expect(result.hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 99 });
        expect(result.decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 7 });
      });
    });

    describe("hook-level settings override", () => {
      it("lets a hook's own hookSettings/decoderSettings override the hook group's settings", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hookSettings: { maxStackFrames: 30 },
          decoderSettings: { maxDepth: 30 },
          hooks: [
            {
              javaClass: "com.example.Foo",
              method: "bar",
              hookSettings: { ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 40 },
              decoderSettings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 },
            },
          ],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect((result.hooks[0] as InputJavaHookNormalized).hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 40 });
        expect((result.hooks[0] as InputJavaHookNormalized).decoderSettings).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 });
      });

      it("merges the hook's own settings on top of the group's, instead of replacing them wholesale", () => {
        // hook files contain partial settings, e.g. `hookSettings: { maxStackFrames: 40 }`
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hookSettings: { maxStackFrames: 30, stackTraceFilter: ["^group"] },
          decoderSettings: { maxDepth: 30, maxItems: 30 },
          hooks: [
            {
              javaClass: "com.example.Foo",
              method: "bar",
              // intentionally only overrides one field of each settings object
              hookSettings: { maxStackFrames: 40 },
              decoderSettings: { maxDepth: 40 },
            } as InputJavaHookNormalized,
          ],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect((result.hooks[0] as InputJavaHookNormalized).hookSettings).toEqual({ maxStackFrames: 40, stackTraceFilter: ["^group"] });
        expect((result.hooks[0] as InputJavaHookNormalized).decoderSettings).toEqual({
          ...DEFAULT_DECODER_SETTINGS,
          maxDepth: 40,
          maxItems: 30,
        });
      });

      it("falls back to the hook group's settings when a hook does not declare its own", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hookSettings: { maxStackFrames: 30 },
          hooks: [{ javaClass: "com.example.Foo", method: "bar" }],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect((result.hooks[0] as InputJavaHookNormalized).hookSettings).toEqual({ ...DEFAULT_HOOK_SETTINGS, maxStackFrames: 30 });
      });

      it("uses the hook's own (merged) decoderSettings, not just the group's, to normalize that hook's overloads", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          decoderSettings: { maxDepth: 30 },
          hooks: [
            {
              javaClass: "com.example.Foo",
              method: "bar",
              decoderSettings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 },
              overloads: [{ params: ["int"] }],
            },
          ],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);
        const hook = result.hooks[0] as InputJavaHookNormalized;

        expect(hook.overloads?.[0].params[0]).toEqual(normalizeInputParams(["int"], { ...DEFAULT_DECODER_SETTINGS, maxDepth: 40 })[0]);
      });
    });

    describe("hook normalization", () => {
      it("normalizes a plain method name string into a full InputJavaHookNormalized", () => {
        const hookCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.Foo", hooks: ["bar"] };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect(result.hooks).toEqual([
          { javaClass: "com.example.Foo", method: "bar", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS },
        ]);
      });

      it("normalizes an object-form hook, always using the hook group's javaClass", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hooks: [{ javaClass: "com.example.WrongClass", method: "bar" }],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect(result.hooks).toEqual([
          { javaClass: "com.example.Foo", method: "bar", hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS },
        ]);
      });

      it("normalizes each overload's params using the merged decoder settings", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hooks: [
            {
              javaClass: "com.example.Foo",
              method: "bar",
              overloads: [{ params: ["int", "java.lang.String"] }],
            },
          ],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect(result.hooks[0]).toEqual({
          javaClass: "com.example.Foo",
          method: "bar",
          overloads: [
            {
              params: normalizeInputParams(["int", "java.lang.String"], DEFAULT_DECODER_SETTINGS),
            },
          ],
          hookSettings: DEFAULT_HOOK_SETTINGS,
          decoderSettings: DEFAULT_DECODER_SETTINGS,
        });
      });

      it("normalizes an overload's retType decoder settings, merged on top of the hook's decoder settings", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          decoderSettings: { maxDepth: 30 },
          hooks: [
            {
              javaClass: "com.example.Foo",
              method: "bar",
              overloads: [{ params: ["int"], retType: { decoder: "myDecoder" } }],
            },
          ],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);
        const hook = result.hooks[0] as InputJavaHookNormalized;

        expect(hook.overloads?.[0].retType).toEqual({ ...DEFAULT_DECODER_SETTINGS, maxDepth: 30, decoder: "myDecoder" });
      });

      it("leaves an overload's retType undefined when not declared", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hooks: [{ javaClass: "com.example.Foo", method: "bar", overloads: [{ params: ["int"] }] }],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);
        const hook = result.hooks[0] as InputJavaHookNormalized;

        expect(hook.overloads?.[0].retType).toBeUndefined();
      });

      describe("rejects type declarations in retType", () => {
        it("rejects a plain type string", () => {
          const hookCollection = {
            type: "java",
            javaClass: "com.example.Foo",
            decoderSettings: { maxDepth: 30 },
            hooks: [{ javaClass: "com.example.Foo", method: "bar", overloads: [{ params: ["int"], retType: "int" }] }],
          };

          expect(() => normalizeJavaHookCollection(hookCollection as unknown as InputJavaHookCollection, defaultSettings)).toThrow(
            "Unrecognized InputRetTypeSettings format",
          );
        });

        it("rejects a [type, decoderSettings] tuple", () => {
          const hookCollection = {
            type: "java",
            javaClass: "com.example.Foo",
            hooks: [
              {
                javaClass: "com.example.Foo",
                method: "bar",
                overloads: [{ params: ["int"], retType: ["int", { decoder: "myDecoder" }] }],
              },
            ],
          };

          expect(() => normalizeJavaHookCollection(hookCollection as unknown as InputJavaHookCollection, defaultSettings)).toThrow(
            "Unrecognized InputRetTypeSettings format",
          );
        });

        it("rejects an object with a type property", () => {
          const hookCollection = {
            type: "java",
            javaClass: "com.example.Foo",
            hooks: [
              {
                javaClass: "com.example.Foo",
                method: "bar",
                overloads: [{ params: ["int"], retType: { type: "int", settings: { ...DEFAULT_DECODER_SETTINGS, decoder: "myDecoder" } } }],
              },
            ],
          };

          expect(() => normalizeJavaHookCollection(hookCollection as unknown as InputJavaHookCollection, defaultSettings)).toThrow(
            "Unrecognized InputRetTypeSettings format",
          );
        });
      });

      it("normalizes multiple hooks, preserving order", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          hooks: ["bar", { javaClass: "com.example.Foo", method: "baz" }],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect(result.hooks.map((hook) => (hook as InputJavaHookNormalized).method)).toEqual(["bar", "baz"]);
      });

      it("normalizes a [method, decoderSettings] tuple, merging its decoderSettings on top of the group's", () => {
        const hookCollection: InputJavaHookCollection = {
          type: "java",
          javaClass: "com.example.Foo",
          decoderSettings: { maxDepth: 30 },
          // hook files contain partial settings, e.g. `{ decoder: "string" }`
          hooks: [["bar", { decoder: "string" }] as [string, DecoderSettings]],
        };

        const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

        expect(result.hooks).toEqual([
          {
            javaClass: "com.example.Foo",
            method: "bar",
            hookSettings: DEFAULT_HOOK_SETTINGS,
            decoderSettings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 30, decoder: "string" },
          },
        ]);
      });
    });

    it("preserves the type and javaClass on the returned hook group", () => {
      const hookCollection: InputJavaHookCollection = { type: "java", javaClass: "com.example.Foo", hooks: [] };

      const result = normalizeJavaHookCollection(hookCollection, defaultSettings);

      expect(result.type).toBe("java");
      expect(result.javaClass).toBe("com.example.Foo");
    });
  });
});

export {};
