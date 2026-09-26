import Java from "frida-java-bridge";
import { MAX_DEPTH_MARKER } from "../../../../shared/decoders/recursiveDecoder";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { BundleDecoder } from "./BundleDecoder";

describe("BundleDecoder", () => {
  const Bundle = Java.use("android.os.Bundle");
  const decoder = new BundleDecoder({
    type: "android.os.Bundle",
    settings: DEFAULT_DECODER_SETTINGS,
  });

  function decodeSingleEntry(bundle: Java.Wrapper): DecodedValue {
    const result = decoder.decode(bundle);
    return result.value[0];
  }

  it("should decode a String extra", () => {
    const bundle = Bundle.$new();
    bundle.putString("key", "hello world");

    expect(decodeSingleEntry(bundle)).toEqual({ type: "java.lang.String", name: "key", value: "hello world" });
  });

  it("should decode an int extra as a real number, not a stringified boxed value", () => {
    const bundle = Bundle.$new();
    bundle.putInt("key", 42);

    expect(decodeSingleEntry(bundle)).toEqual({ type: "int", name: "key", value: 42 });
  });

  it("should decode a false boolean extra correctly (regression: falsy values used to be treated as absent)", () => {
    const bundle = Bundle.$new();
    bundle.putBoolean("key", false);

    expect(decodeSingleEntry(bundle)).toEqual({ type: "boolean", name: "key", value: false });
  });

  it("should decode a zero int extra correctly (regression: falsy values used to be treated as absent)", () => {
    const bundle = Bundle.$new();
    bundle.putInt("key", 0);

    expect(decodeSingleEntry(bundle)).toEqual({ type: "int", name: "key", value: 0 });
  });

  it("should decode a long extra as a decimal string to avoid precision loss", () => {
    const bundle = Bundle.$new();
    const maxLong = Java.use("java.lang.Long").$new("9223372036854775807").longValue();
    bundle.putLong("key", maxLong);

    expect(decodeSingleEntry(bundle)).toEqual({ type: "long", name: "key", value: "9223372036854775807" });
  });

  it("should decode an int array extra (regression: arrays used to decode to a useless Object.toString())", () => {
    const bundle = Bundle.$new();
    bundle.putIntArray("key", Java.array("int", [1, 2, 3]));

    expect(decodeSingleEntry(bundle)).toEqual({ type: "[I", name: "key", value: [1, 2, 3] });
  });

  it("should decode a String array extra", () => {
    const bundle = Bundle.$new();
    bundle.putStringArray("key", Java.array("java.lang.String", ["a", "b"]));

    expect(decodeSingleEntry(bundle)).toEqual({ type: "[Ljava.lang.String;", name: "key", value: ["a", "b"] });
  });

  it("should decode a byte array extra via the typed getter fast path (avoids reflect.Array per element)", () => {
    const bundle = Bundle.$new();
    bundle.putByteArray("key", Java.array("byte", [0x41, 0x42, 0x43]));

    expect(decodeSingleEntry(bundle)).toEqual({ type: "[B", name: "key", value: [0x41, 0x42, 0x43] });
  });

  it("should decode a boolean array extra via the typed getter fast path", () => {
    const bundle = Bundle.$new();
    bundle.putBooleanArray("key", Java.array("boolean", [true, false, true]));

    expect(decodeSingleEntry(bundle)).toEqual({ type: "[Z", name: "key", value: [true, false, true] });
  });

  it("should decode a CharSequence array extra via the generic reflection fallback (no typed getter registered)", () => {
    const bundle = Bundle.$new();
    const JavaString = Java.use("java.lang.String");
    const items = Java.array("java.lang.CharSequence", [JavaString.$new("x"), JavaString.$new("y")]);
    bundle.putCharSequenceArray("key", items);

    expect(decodeSingleEntry(bundle)).toEqual({ type: "[Ljava.lang.CharSequence;", name: "key", value: ["x", "y"] });
  });

  it("should truncate an int array extra at maxItems and append a truncation marker (typed getter path)", () => {
    const bundle = Bundle.$new();
    bundle.putIntArray("key", Java.array("int", [1, 2, 3, 4, 5]));

    const limitedDecoder = new BundleDecoder({
      type: "android.os.Bundle",
      settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 3 },
    });

    expect(limitedDecoder.decode(bundle).value[0]).toEqual({ type: "[I", name: "key", value: [1, 2, 3, "[truncated at 3]"] });
  });

  it("should truncate a CharSequence array extra at maxItems and append a truncation marker (reflection fallback path)", () => {
    const bundle = Bundle.$new();
    const JavaString = Java.use("java.lang.String");
    const items = Java.array("java.lang.CharSequence", [JavaString.$new("a"), JavaString.$new("b"), JavaString.$new("c")]);
    bundle.putCharSequenceArray("key", items);

    const limitedDecoder = new BundleDecoder({
      type: "android.os.Bundle",
      settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 2 },
    });

    expect(limitedDecoder.decode(bundle).value[0]).toEqual({
      type: "[Ljava.lang.CharSequence;",
      name: "key",
      value: ["a", "b", "[truncated at 2]"],
    });
  });

  it("should decode a null-valued extra without throwing (regression: used to crash reading '.value' of null)", () => {
    const bundle = Bundle.$new();
    bundle.putString("key", null);

    expect(decodeSingleEntry(bundle)).toEqual({ type: "null", name: "key", value: null });
  });

  it("should decode every key in the bundle", () => {
    const bundle = Bundle.$new();
    bundle.putString("a", "1");
    bundle.putInt("b", 2);

    const result = decoder.decode(bundle);

    expect(result.type).toBe("android.os.Bundle");
    expect(result.value).toEqual([
      { type: "java.lang.String", name: "a", value: "1" },
      { type: "int", name: "b", value: 2 },
    ]);
  });

  it("should decode an empty bundle to an empty array", () => {
    const bundle = Bundle.$new();

    const result = decoder.decode(bundle);

    expect(result).toEqual({ type: "android.os.Bundle", value: [] });
  });

  it("should truncate the extras at maxItems and append a truncation marker", () => {
    const bundle = Bundle.$new();
    bundle.putString("a", "1");
    bundle.putString("b", "2");
    bundle.putString("c", "3");

    const limitedDecoder = new BundleDecoder({ type: "android.os.Bundle", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 2 } });
    const values = limitedDecoder.decode(bundle).value as DecodedValue[];

    expect(values.length).toBe(3);
    expect(values[2]).toEqual({ type: "java.lang.String", value: "[truncated at 2]" });
  });

  it("should replace a nested Bundle and an array extra with a max depth marker once maxDepth is used up", () => {
    const inner = Bundle.$new();
    inner.putString("innerKey", "x");
    const bundle = Bundle.$new();
    bundle.putBundle("nested", inner);
    bundle.putIntArray("array", Java.array("int", [1, 2]));
    bundle.putString("string", "y");

    const limitedDecoder = new BundleDecoder({ type: "android.os.Bundle", settings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 1 } });
    const values = limitedDecoder.decode(bundle).value as DecodedValue[];
    const findEntry = (name: string): DecodedValue | undefined => values.find((entry) => entry.name === name);

    expect(findEntry("nested")).toEqual({ type: "android.os.Bundle", name: "nested", value: MAX_DEPTH_MARKER });
    expect(findEntry("array")).toEqual({ type: "[I", name: "array", value: MAX_DEPTH_MARKER });
    expect(findEntry("string")).toEqual({ type: "java.lang.String", name: "string", value: "y" });
  });
});

export {};
