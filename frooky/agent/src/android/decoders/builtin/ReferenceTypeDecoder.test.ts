import Java from "frida-java-bridge";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { ReferenceTypeDecoder } from "./ReferenceTypeDecoder";

describe("ReferenceTypeDecoder", () => {
  describe("decode()", () => {
    it("resolves a class decoder for a known runtime class (branch 1)", () => {
      const ContentValues = Java.use("android.content.ContentValues");
      const contentValues = ContentValues.$new();
      contentValues.put("key", "value");

      const decoder = new ReferenceTypeDecoder({ type: "android.content.ContentValues", settings: DEFAULT_DECODER_SETTINGS });
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

      const decoder = new ReferenceTypeDecoder({ type: "java.lang.Iterable", settings: DEFAULT_DECODER_SETTINGS });
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
      const decoder = new ReferenceTypeDecoder({ type: "java.util.List", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(list);

      expect(result).toEqual({
        type: "java.util.List",
        value: {
          type: "java.util.ArrayList",
          value: [{ type: "java.lang.String", value: "a" }],
        },
      });
    });

    it("falls back to StringDecoder when no class or interface decoder is registered (branch 4)", () => {
      const JavaObject = Java.use("java.lang.Object");
      const javaObject = JavaObject.$new();

      const decoder = new ReferenceTypeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(javaObject);

      expect(result.type).toBe("java.lang.Object");
      const inner = result.value as DecodedValue;
      expect(inner.type).toBe("java.lang.Object");
      expect(inner.value).toBe(javaObject.toString());
    });

    it("decodes java.lang.String via the StringDecoder fallback (branch 4)", () => {
      // a String has no class/interface decoder registered, so it reaches the same toString()
      // fallback as everything else in branch 4 - which is correct here since String.toString()
      // is itself, and there's no GetterDecoder in this chain to reflect its own getBytes() etc.
      const JavaString = Java.use("java.lang.String");
      const value = JavaString.$new("hello world");

      const decoder = new ReferenceTypeDecoder({ type: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(value);

      expect(result).toEqual({
        type: "java.lang.String",
        value: { type: "java.lang.String", value: "hello world" },
      });
    });

    it("decodes java.lang.Class via the StringDecoder fallback without recursing into its own getters (branch 4, regression)", () => {
      // regression: Class's own declared getters (getDeclaredMethods(), getFields(), ...) return
      // arrays of Method/Field/Constructor objects that point straight back to their declaring
      // Class via getDeclaringClass() - reflecting those via GetterDecoder would recurse without
      // bound and crash the Frida script ("Fatal error: Script is destroyed") by exhausting the
      // native call stack. The branch 4 fallback never calls GetterDecoder, so this completes and
      // decodes the Class as a plain string instead.
      const JavaObject = Java.use("java.lang.Object");
      const classValue = JavaObject.class;

      const decoder = new ReferenceTypeDecoder({ type: "java.lang.Class", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(classValue);

      expect(result).toEqual({
        type: "java.lang.Class",
        value: { type: "java.lang.Class", value: classValue.toString() },
      });
    });

    it("decodes java.math.BigInteger via the StringDecoder fallback (branch 4)", () => {
      // BigInteger has no "get"-prefixed methods, so reflecting its getters would silently lose
      // the value entirely (an empty properties array) - it's decoded via toString() instead
      const BigInteger = Java.use("java.math.BigInteger");
      const value = BigInteger.$new("123456789");

      const decoder = new ReferenceTypeDecoder({ type: "java.math.BigInteger", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(value);

      expect(result).toEqual({
        type: "java.math.BigInteger",
        value: { type: "java.math.BigInteger", value: value.toString() },
      });
    });

    it("resolves the decoder independently for each call instead of reusing the first call's decoder (regression)", () => {
      // a single instance is reused across every invocation of a hooked method in practice
      // (see androidHookManager.ts), so a declared supertype like java.lang.Object must be
      // re-resolved per call rather than locked to whichever runtime class showed up first
      const decoder = new ReferenceTypeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });

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
      const decoder = new ReferenceTypeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.lang.Object", value: null });
    });
  });
});
