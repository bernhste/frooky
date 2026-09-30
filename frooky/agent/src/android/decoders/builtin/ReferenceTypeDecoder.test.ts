import Java from "frida-java-bridge";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { IntentDecoder } from "../android/content/IntentDecoder";
import { KeyGenParameterSpecDecoder } from "../android/security/keystore/KeyGenParameterSpecDecoder";
import { KeyDecoder } from "../java/security/KeyDecoder";
import { SpecDecoder } from "../java/security/spec/SpecDecoder";
import { IterableDecoder } from "../java/lang/IterableDecoder";
import { MapDecoder } from "../java/util/MapDecoder";
import { HashCodeDecoder } from "./HashCodeDecoder";
import { ReferenceTypeDecoder, resolveDecoderClass } from "./ReferenceTypeDecoder";
import { StringDecoder } from "./StringDecoder";

describe("ReferenceTypeDecoder", () => {
  describe("decode()", () => {
    it("resolves a class decoder for a known runtime class", () => {
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

    it("resolves an interface decoder for a value declared as the interface", () => {
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

    it("resolves an interface decoder implemented through the interface hierarchy", () => {
      const ArrayList = Java.use("java.util.ArrayList");
      const list = ArrayList.$new();
      list.add("a");

      // only java.lang.Iterable is registered, found via ArrayList -> List -> Collection -> Iterable
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

    it("falls back to StringDecoder when no class or interface decoder is registered", () => {
      const JavaObject = Java.use("java.lang.Object");
      const javaObject = JavaObject.$new();

      const decoder = new ReferenceTypeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(javaObject);

      expect(result.type).toBe("java.lang.Object");
      const inner = result.value as DecodedValue;
      expect(inner.type).toBe("java.lang.Object");
      expect(inner.value).toBe(javaObject.toString());
    });

    it("decodes java.lang.String via the StringDecoder fallback", () => {
      const JavaString = Java.use("java.lang.String");
      const value = JavaString.$new("hello world");

      const decoder = new ReferenceTypeDecoder({ type: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(value);

      expect(result).toEqual({
        type: "java.lang.String",
        value: { type: "java.lang.String", value: "hello world" },
      });
    });

    it("decodes java.lang.Class via the StringDecoder fallback without recursing into its own getters", () => {
      // the getters of Class/Method/Field reference each other endlessly
      const JavaObject = Java.use("java.lang.Object");
      const classValue = JavaObject.class;

      const decoder = new ReferenceTypeDecoder({ type: "java.lang.Class", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(classValue);

      expect(result).toEqual({
        type: "java.lang.Class",
        value: { type: "java.lang.Class", value: classValue.toString() },
      });
    });

    it("decodes java.math.BigInteger via the StringDecoder fallback", () => {
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

    it("decodes an unregistered interface value via the StringDecoder fallback using its Java toString()", () => {
      const BigInteger = Java.use("java.math.BigInteger");
      const value = BigInteger.$new("123456789");
      const asInterface = Java.cast(value, Java.use("java.io.Serializable"));

      const decoder = new ReferenceTypeDecoder({ type: "java.io.Serializable", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(asInterface);

      expect(result).toEqual({
        type: "java.io.Serializable",
        value: { type: "java.math.BigInteger", value: "123456789" },
      });
    });

    it("decodes an unregistered interface value with no overridden toString() using Java Object.toString()", () => {
      // java.util.Random implements Serializable but does not override toString()
      const Random = Java.use("java.util.Random");
      const random = Random.$new();
      const asInterface = Java.cast(random, Java.use("java.io.Serializable"));

      const decoder = new ReferenceTypeDecoder({ type: "java.io.Serializable", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(asInterface);

      expect(result.type).toBe("java.io.Serializable");
      const inner = result.value as DecodedValue;
      expect(inner.type).toBe("java.util.Random");
      expect(inner.value).not.toBe("[object Object]");
      expect((inner.value as string).startsWith("java.util.Random@")).toBe(true);
    });

    it("resolves the class decoder of a superclass for a subclass without its own decoder", () => {
      // LabeledIntent extends Intent
      const Intent = Java.use("android.content.Intent");
      const LabeledIntent = Java.use("android.content.pm.LabeledIntent");
      const labeledIntent = LabeledIntent.$new(Intent.$new("android.intent.action.VIEW"), "com.example", 0, 0);

      const decoder = new ReferenceTypeDecoder({ type: "android.content.Intent", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(labeledIntent);

      const inner = result.value as DecodedValue;
      expect(inner.type).toBe("android.content.Intent");
      const properties = inner.value as DecodedValue[];
      expect(properties.find((property) => property.name === "action")).toEqual({
        type: "java.lang.String",
        name: "action",
        value: "android.intent.action.VIEW",
      });
    });

    it("resolves the decoder by the runtime class of each call", () => {
      // a hook reuses one decoder instance for all calls
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
      // frida-java-bridge passes a null Java reference as a JS null
      const decoder = new ReferenceTypeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "java.lang.Object", value: null });
    });
  });

  describe("resolveDecoderClass()", () => {
    // decoder classes only serve as markers here, e.g. MapDecoder for java.util.Collection
    const arrayListClass = () => Java.use("java.util.ArrayList").class;

    it("prefers the class decoder of the runtime class over the one of a superclass", () => {
      const resolution = resolveDecoderClass(arrayListClass(), { "java.util.ArrayList": HashCodeDecoder, "java.util.AbstractList": MapDecoder }, []);

      expect(resolution.decoderClass).toBe(HashCodeDecoder);
      expect(resolution.reason).toBe("class decoder for java.util.ArrayList");
    });

    it("resolves the class decoder of the nearest superclass", () => {
      // ArrayList -> AbstractList -> AbstractCollection -> Object
      const resolution = resolveDecoderClass(
        arrayListClass(),
        { "java.util.AbstractList": MapDecoder, "java.util.AbstractCollection": HashCodeDecoder },
        [],
      );

      expect(resolution.decoderClass).toBe(MapDecoder);
      expect(resolution.reason).toBe("class decoder for superclass java.util.AbstractList");
    });

    it("prefers a class decoder over an interface decoder", () => {
      const resolution = resolveDecoderClass(arrayListClass(), { "java.util.AbstractList": HashCodeDecoder }, [["java.util.List", IterableDecoder]]);

      expect(resolution.decoderClass).toBe(HashCodeDecoder);
    });

    it("prefers an interface over the interfaces it extends, regardless of the registry order", () => {
      // List extends Collection extends Iterable
      const resolution = resolveDecoderClass(arrayListClass(), {}, [
        ["java.lang.Iterable", IterableDecoder],
        ["java.util.Collection", MapDecoder],
      ]);

      expect(resolution).toEqual({ decoderClass: MapDecoder, reason: "interface decoder for java.util.Collection", ambiguousWith: undefined });
    });

    it("uses the registry order among unrelated interfaces and reports the others", () => {
      // ArrayList implements List and RandomAccess, which are unrelated
      const iterableFirst = resolveDecoderClass(arrayListClass(), {}, [
        ["java.lang.Iterable", IterableDecoder],
        ["java.util.RandomAccess", HashCodeDecoder],
      ]);
      expect(iterableFirst.decoderClass).toBe(IterableDecoder);
      expect(iterableFirst.ambiguousWith).toEqual(["java.util.RandomAccess"]);

      const randomAccessFirst = resolveDecoderClass(arrayListClass(), {}, [
        ["java.util.RandomAccess", HashCodeDecoder],
        ["java.lang.Iterable", IterableDecoder],
      ]);
      expect(randomAccessFirst.decoderClass).toBe(HashCodeDecoder);
      expect(randomAccessFirst.ambiguousWith).toEqual(["java.lang.Iterable"]);
    });

    it("drops the interfaces extended by another match before applying the registry order", () => {
      // Iterable is extended by List, so only List and RandomAccess compete
      const resolution = resolveDecoderClass(arrayListClass(), {}, [
        ["java.lang.Iterable", IterableDecoder],
        ["java.util.List", MapDecoder],
        ["java.util.RandomAccess", HashCodeDecoder],
      ]);

      expect(resolution.decoderClass).toBe(MapDecoder);
      expect(resolution.ambiguousWith).toEqual(["java.util.RandomAccess"]);
    });

    it("ignores registered interfaces the class doesn't implement or that don't exist", () => {
      const resolution = resolveDecoderClass(arrayListClass(), {}, [
        ["java.util.Map", MapDecoder],
        ["com.example.DoesNotExist", HashCodeDecoder],
        ["java.lang.Iterable", IterableDecoder],
      ]);

      expect(resolution).toEqual({ decoderClass: IterableDecoder, reason: "interface decoder for java.lang.Iterable", ambiguousWith: undefined });
    });

    it("falls back to toString() without a matching class or interface decoder", () => {
      const resolution = resolveDecoderClass(arrayListClass(), { "android.os.Bundle": IntentDecoder }, [["java.util.Map", MapDecoder]]);

      expect(resolution.decoderClass).toBe(StringDecoder);
    });

    it("resolves the built-in registries", () => {
      const resolve = (className: string) => resolveDecoderClass(Java.use(className).class);

      expect(resolve("android.content.Intent").decoderClass).toBe(IntentDecoder);
      expect(resolve("java.util.HashMap").decoderClass).toBe(MapDecoder);
      expect(resolve("java.util.ArrayList").decoderClass).toBe(IterableDecoder);
      expect(resolve("javax.crypto.spec.GCMParameterSpec").decoderClass).toBe(SpecDecoder);
      // a class decoder wins over the AlgorithmParameterSpec interface
      expect(resolve("android.security.keystore.KeyGenParameterSpec").decoderClass).toBe(KeyGenParameterSpecDecoder);
      // Key comes before KeySpec in the registry
      const secretKeySpec = resolve("javax.crypto.spec.SecretKeySpec");
      expect(secretKeySpec.decoderClass).toBe(KeyDecoder);
      expect(secretKeySpec.ambiguousWith).toEqual(["java.security.spec.KeySpec"]);
      // StringBuilder implements CharSequence, Appendable, Serializable and Comparable
      expect(resolve("java.lang.StringBuilder")).toEqual({
        decoderClass: StringDecoder,
        reason: "interface decoder for java.lang.CharSequence",
        ambiguousWith: undefined,
      });
      expect(resolve("android.os.Bundle").reason).toBe("class decoder for superclass android.os.BaseBundle");
    });
  });
});
