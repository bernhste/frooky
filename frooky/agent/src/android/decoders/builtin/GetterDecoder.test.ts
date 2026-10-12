import Java from "frida-java-bridge";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { JavaDecoderResolver } from "../javaDecoderResolver";
import { GetterDecoder } from "./GetterDecoder";

describe("GetterDecoder", () => {
  describe("decode()", () => {
    const JavaObject = Java.use("java.lang.Object");
    const decoder = new GetterDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });

    it("should decode every public getter, stripping the get/is prefix from the property name", () => {
      const javaObject = JavaObject.$new();
      const result = decoder.decode(javaObject);

      expect(result.type).toBe("java.lang.Object");
      const properties = result.value as DecodedValue[];
      // Object's only declared "get*" method is getClass(), which decodeGetterValues exposes
      // with the prefix stripped to "class".
      const classProperty = properties.find((p) => p.name === "class");
      expect(classProperty?.type).toBe("java.lang.Class");
    });

    it("should decode getClass()'s result via toString(), not by recursing into its own getters", () => {
      // the getters of Class/Method/Field reference each other endlessly
      const javaObject = JavaObject.$new();
      const result = decoder.decode(javaObject);

      const properties = result.value as DecodedValue[];
      const classProperty = properties.find((p) => p.name === "class");
      // ReferenceTypeDecoder wraps the result of the StringDecoder fallback
      const nestedValue = classProperty?.value as DecodedValue;
      expect(nestedValue.type).toBe("java.lang.Class");
      expect(typeof nestedValue.value).toBe("string");
    });

    it("should include the decodable name in the result", () => {
      const namedDecoder = new GetterDecoder({ type: "java.lang.Object", name: "myParam", settings: DEFAULT_DECODER_SETTINGS });
      const javaObject = JavaObject.$new();
      const result = namedDecoder.decode(javaObject);

      expect(result.type).toBe("java.lang.Object");
      expect(result.name).toBe("myParam");
      expect(Array.isArray(result.value)).toBe(true);
    });
  });

  it("decodes the get*() and is*() getters of the runtime class and its superclasses", () => {
    const uri = Java.use("java.net.URI").create("https://example.org");
    const decoder = new GetterDecoder({ type: "java.net.URI", settings: DEFAULT_DECODER_SETTINGS });

    const properties = decoder.decode(uri).value as DecodedValue[];

    expect(properties.find((p) => p.name === "host")?.value).toBe("example.org");
    expect(properties.find((p) => p.name === "absolute")?.value).toBe(true);
  });

  it("decodes the values of the getters with their default decoders, not with `decoder: getters` again", () => {
    // an enum's getDeclaringClass() returns its Class, whose getters lead to ever more classes, methods and fields
    const seconds = Java.use("java.util.concurrent.TimeUnit").SECONDS.value;
    const settings = { ...DEFAULT_DECODER_SETTINGS, decoder: "getters" as const };

    const decoded = JavaDecoderResolver.resolveDecoder({ type: "java.util.concurrent.TimeUnit", name: "unit", settings }).decode(seconds);

    const properties = JSON.parse(JSON.stringify(decoded)).value as DecodedValue[];
    expect(properties).toEqual([
      {
        type: "java.lang.Class",
        name: "declaringClass",
        value: { type: "java.lang.Class", value: "class java.util.concurrent.TimeUnit" },
      },
    ]);
  });

  it("calls no getter that changes the object: the relative reads of a buffer and getAnd*()", () => {
    const buffer = Java.use("java.nio.ByteBuffer").allocate(16);
    const counter = Java.use("java.util.concurrent.atomic.AtomicInteger").$new(5);
    const settings = { ...DEFAULT_DECODER_SETTINGS, decoder: "getters" as const };

    const bufferGetters = new GetterDecoder({ type: "java.nio.ByteBuffer", settings }).decode(buffer).value as DecodedValue[];
    const counterGetters = new GetterDecoder({ type: "java.util.concurrent.atomic.AtomicInteger", settings }).decode(counter).value as DecodedValue[];

    // position() is declared by java.nio.Buffer
    expect(Java.cast(buffer, Java.use("java.nio.Buffer")).position()).toBe(0);
    expect(counter.get()).toBe(5);
    const bufferNames = bufferGetters.map((getter) => getter.name);
    for (const name of ["char", "short", "int", "long", "float", "double"]) expect(bufferNames).not.toContain(name);
    expect(bufferNames).toContain("direct");
    expect(counterGetters.map((getter) => getter.name).filter((name) => name?.startsWith("and"))).toEqual([]);
  });
});
