import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { JavaReferenceTypeDecoder } from "./javaReferenceTypeDecoder";

describe("JavaReferenceTypeDecoder", () => {
  describe("decode()", () => {
    it("resolves a class decoder for a known runtime class (branch 1)", () => {
      const ContentValues = Java.use("android.content.ContentValues");
      const contentValues = ContentValues.$new();
      contentValues.put("key", "value");

      const decoder = new JavaReferenceTypeDecoder({ type: "android.content.ContentValues", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(contentValues);

      expect(result).toEqual({
        type: "android.content.ContentValues",
        value: { type: "android.content.ContentValues", value: { key: "value" } },
      });
    });

    it("resolves an interface decoder for the declared type (branch 2)", () => {
      const ArrayList = Java.use("java.util.ArrayList");
      const list = ArrayList.$new();
      list.add("a");
      list.add("b");

      const decoder = new JavaReferenceTypeDecoder({ type: "java.lang.Iterable", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(list);

      expect(result).toEqual({
        type: "java.lang.Iterable",
        value: {
          type: "java.util.ArrayList",
          value: [
            { type: "java.lang.String", value: "a" },
            { type: "java.lang.String", value: "b" },
          ],
        },
      });
    });

    it("resolves an interface decoder by walking the class hierarchy when the declared type isn't registered directly (branch 3)", () => {
      const ArrayList = Java.use("java.util.ArrayList");
      const list = ArrayList.$new();
      list.add("a");

      // "java.util.List" is not in the interface registry itself, only "java.lang.Iterable" is -
      // this only resolves correctly by walking ArrayList -> List -> Collection -> Iterable
      const decoder = new JavaReferenceTypeDecoder({ type: "java.util.List", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(list);

      expect(result).toEqual({
        type: "java.util.List",
        value: {
          type: "java.util.ArrayList",
          value: [{ type: "java.lang.String", value: "a" }],
        },
      });
    });

    it("falls back to JavaFallbackDecoder when no class or interface decoder is registered", () => {
      const JavaObject = Java.use("java.lang.Object");
      const javaObject = JavaObject.$new();

      const decoder = new JavaReferenceTypeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(javaObject);

      expect(result).toEqual({
        type: "java.lang.Object",
        value: { type: "java.lang.Object", value: javaObject.toString() },
      });
    });

    it("resolves the decoder independently for each call instead of reusing the first call's decoder (regression)", () => {
      // a single instance is reused across every invocation of a hooked method in practice
      // (see androidHookManager.ts), so a declared supertype like java.lang.Object must be
      // re-resolved per call rather than locked to whichever runtime class showed up first
      const decoder = new JavaReferenceTypeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });

      const JavaString = Java.use("java.lang.String");
      const firstValue = JavaString.$new("first-call value");
      const firstResult = decoder.decode(firstValue);

      expect(firstResult).toEqual({
        type: "java.lang.Object",
        value: { type: "java.lang.String", value: "first-call value" },
      });

      const ArrayList = Java.use("java.util.ArrayList");
      const list = ArrayList.$new();
      list.add("a");
      const secondResult = decoder.decode(list);

      expect(secondResult).toEqual({
        type: "java.lang.Object",
        value: {
          type: "java.util.ArrayList",
          value: [{ type: "java.lang.String", value: "a" }],
        },
      });
    });

    it("should decode a null value without throwing", () => {
      // frida-java-bridge hands back plain JS null for a null Java reference (e.g. an
      // Object-typed return value that is actually null at runtime)
      const decoder = new JavaReferenceTypeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.lang.Object", value: null });
    });
  });
});
