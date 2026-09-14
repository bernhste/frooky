import Java from "frida-java-bridge";
import { DecodedValue } from "../../shared/decoders/decodedValue";
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

      expect(result.type).toBe("java.lang.Object");
      const inner = result.value as DecodedValue;
      expect(inner.type).toBe("java.lang.Object");
      // Object's only declared "get*" method is getClass(), which JavaFallbackDecoder now
      // reflects and invokes (via decodeGetterValues) instead of just calling toString()
      const properties = inner.value as DecodedValue[];
      expect(properties.find((p) => p.name === "class")?.type).toBe("java.lang.Class");
    });

    it("routes java.lang.String to JavaPrimitiveDecoder instead of falling back to JavaFallbackDecoder", () => {
      // regression: JavaFallbackDecoder used to just call toString() on any unregistered type,
      // which happened to also produce the right value for a String (its toString() is itself) -
      // now that it reflects and invokes getters instead, String must be special-cased here so it
      // doesn't get decoded via its own getBytes()/getClass()-style getters
      const JavaString = Java.use("java.lang.String");
      const value = JavaString.$new("hello world");

      const decoder = new JavaReferenceTypeDecoder({ type: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(value);

      expect(result).toEqual({
        type: "java.lang.String",
        value: { type: "java.lang.String", value: "hello world" },
      });
    });

    it("routes java.lang.Class to JavaReflectionMetadataDecoder instead of falling back to JavaFallbackDecoder (regression)", () => {
      // regression: Class's own declared getters (getDeclaredMethods(), getFields(), ...) return
      // arrays of Method/Field/Constructor objects that point straight back to their declaring
      // Class via getDeclaringClass() - reflecting those via JavaFallbackDecoder recursed without
      // bound and crashed the Frida script ("Fatal error: Script is destroyed") by exhausting the
      // native call stack. This must complete and decode the Class as a plain string instead.
      const JavaObject = Java.use("java.lang.Object");
      const classValue = JavaObject.class;

      const decoder = new JavaReferenceTypeDecoder({ type: "java.lang.Class", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(classValue);

      expect(result).toEqual({
        type: "java.lang.Class",
        value: { type: "java.lang.Class", value: classValue.toString() },
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
