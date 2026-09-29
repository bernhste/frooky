import Java from "frida-java-bridge";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { MAX_DEPTH_MARKER } from "../../../shared/decoders/recursiveDecoder";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { ArrayDecoder } from "./ArrayDecoder";

describe("ArrayDecoder", () => {
  describe("decode()", () => {
    it("decodes a primitive int array without going through an element decoder", () => {
      const array = Java.array("int", [1, 2, 3]);
      const decoder = new ArrayDecoder({ type: "[I", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(array as unknown as Java.Wrapper)).toEqual({ type: "[I", value: [1, 2, 3] });
    });

    it("decodes a primitive boolean array", () => {
      const array = Java.array("boolean", [true, false, true]);
      const decoder = new ArrayDecoder({ type: "[Z", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(array as unknown as Java.Wrapper)).toEqual({ type: "[Z", value: [true, false, true] });
    });

    it("decodes a primitive byte array", () => {
      const array = Java.array("byte", [0x41, 0x42, 0x43]);
      const decoder = new ArrayDecoder({ type: "[B", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(array as unknown as Java.Wrapper)).toEqual({ type: "[B", value: [0x41, 0x42, 0x43] });
    });

    it("decodes a primitive short array", () => {
      const array = Java.array("short", [1000, 2000, -3000]);
      const decoder = new ArrayDecoder({ type: "[S", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(array as unknown as Java.Wrapper)).toEqual({ type: "[S", value: [1000, 2000, -3000] });
    });

    it("decodes a primitive char array", () => {
      const array = Java.array("char", ["h", "i"]);
      const decoder = new ArrayDecoder({ type: "[C", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(array as unknown as Java.Wrapper)).toEqual({ type: "[C", value: ["h", "i"] });
    });

    it("decodes a primitive float array", () => {
      const array = Java.array("float", [1.5, 2.5]);
      const decoder = new ArrayDecoder({ type: "[F", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(array as unknown as Java.Wrapper);
      expect(result.type).toBe("[F");
      const values = result.value as number[];
      expect(values.length).toBe(2);
      expect(Math.abs(values[0] - 1.5) < 0.001).toBe(true);
      expect(Math.abs(values[1] - 2.5) < 0.001).toBe(true);
    });

    it("decodes a primitive double array", () => {
      const array = Java.array("double", [3.14, 2.718]);
      const decoder = new ArrayDecoder({ type: "[D", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(array as unknown as Java.Wrapper);
      expect(result.type).toBe("[D");
      const values = result.value as number[];
      expect(values.length).toBe(2);
      expect(Math.abs(values[0] - 3.14) < 0.001).toBe(true);
      expect(Math.abs(values[1] - 2.718) < 0.001).toBe(true);
    });

    it("decodes a primitive long array", () => {
      const array = Java.array("long", [1234567890]);
      const decoder = new ArrayDecoder({ type: "[J", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(array as unknown as Java.Wrapper);
      expect(result.type).toBe("[J");
      const values = result.value as unknown[];
      expect(values[0]?.toString()).toBe("1234567890");
    });

    it("falls back gracefully when withElements is not defined (e.g. mock or plain array)", () => {
      const mockArray = [10, 20, 30];
      const decoder = new ArrayDecoder({ type: "[I", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(mockArray as unknown as Java.Wrapper)).toEqual({ type: "[I", value: [10, 20, 30] });
    });

    it("returns an empty array for an empty primitive array", () => {
      const array = Java.array("int", []);
      const decoder = new ArrayDecoder({ type: "[I", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(array as unknown as Java.Wrapper)).toEqual({ type: "[I", value: [] });
    });

    it("decodes a null array as null instead of throwing", () => {
      const decoder = new ArrayDecoder({ type: "[Ljava.lang.String;", name: "selectionArgs", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(null as unknown as Java.Wrapper)).toEqual({ type: "[Ljava.lang.String;", name: "selectionArgs", value: null });
    });

    it("decodes a null array as null even when maxDepth is exhausted", () => {
      const decoder = new ArrayDecoder({ type: "[I", settings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 0 } });

      expect(decoder.decode(null as unknown as Java.Wrapper)).toEqual({ type: "[I", value: null });
    });

    it("decodes an object array of Strings via the resolved element decoder", () => {
      const array = Java.array("java.lang.String", ["a", "b"]);
      const decoder = new ArrayDecoder({ type: "[Ljava.lang.String;", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(array as unknown as Java.Wrapper)).toEqual({ type: "[Ljava.lang.String;", value: ["a", "b"] });
    });

    it("decodes an array of reference-type elements by delegating to a decoder resolved per element", () => {
      // java.lang.Object elements are decoded via ReferenceTypeDecoder's toString() fallback
      const JavaObject = Java.use("java.lang.Object");
      const objA = JavaObject.$new();
      const objB = JavaObject.$new();
      const array = Java.array("java.lang.Object", [objA, objB]);

      const decoder = new ArrayDecoder({ type: "[Ljava.lang.Object;", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(array as unknown as Java.Wrapper);

      expect(result.type).toBe("[Ljava.lang.Object;");
      const values = result.value as DecodedValue[];
      expect(values).toEqual([
        { type: "java.lang.Object", value: objA.toString() },
        { type: "java.lang.Object", value: objB.toString() },
      ]);
    });

    it("decodes a nested array by resolving another ArrayDecoder for the element type", () => {
      // the element type of int[][] is "[I"
      const inner1 = Java.array("int", [1, 2]);
      const inner2 = Java.array("int", [3, 4]);
      const nested = Java.array("[I", [inner1, inner2]);

      const decoder = new ArrayDecoder({ type: "[[I", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(nested as unknown as Java.Wrapper)).toEqual({
        type: "[[I",
        value: [
          [1, 2],
          [3, 4],
        ],
      });
    });

    it("carries the decodable's name through to the returned DecodedValue", () => {
      const array = Java.array("int", [1]);
      const decoder = new ArrayDecoder({ type: "[I", name: "myArray", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(array as unknown as Java.Wrapper)).toEqual({ type: "[I", name: "myArray", value: [1] });
    });

    it("should truncate a primitive array at maxItems and append a truncation marker", () => {
      const array = Java.array("int", [1, 2, 3, 4, 5]);
      const decoder = new ArrayDecoder({ type: "[I", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 3 } });

      expect(decoder.decode(array as unknown as Java.Wrapper)).toEqual({ type: "[I", value: [1, 2, 3, "[truncated at 3]"] });
    });

    it("should truncate an object array at maxItems and append a truncation marker", () => {
      const array = Java.array("java.lang.String", ["a", "b", "c"]);
      const decoder = new ArrayDecoder({ type: "[Ljava.lang.String;", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 2 } });

      expect(decoder.decode(array as unknown as Java.Wrapper)).toEqual({
        type: "[Ljava.lang.String;",
        value: ["a", "b", "[truncated at 2]"],
      });
    });

    it("returns a max depth marker instead of the elements when maxDepth is used up", () => {
      const array = Java.array("int", [1, 2, 3]);
      const decoder = new ArrayDecoder({ type: "[I", settings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 0 } });

      expect(decoder.decode(array as unknown as Java.Wrapper)).toEqual({ type: "[I", value: MAX_DEPTH_MARKER });
    });

    it("decodes the elements one level deeper, replacing nested containers once maxDepth is used up", () => {
      const list = Java.use("java.util.ArrayList").$new();
      list.add("a");
      const array = Java.array("java.lang.Object", [list, "b"]);

      const decoder = new ArrayDecoder({ type: "[Ljava.lang.Object;", settings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 1 } });

      expect(decoder.decode(array as unknown as Java.Wrapper).value).toEqual([
        { type: "java.util.ArrayList", value: MAX_DEPTH_MARKER },
        { type: "java.lang.String", value: "b" },
      ]);
    });
  });
});

export {};
