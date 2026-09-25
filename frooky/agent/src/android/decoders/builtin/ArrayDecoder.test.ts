import Java from "frida-java-bridge";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
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

    it("returns an empty array for an empty primitive array", () => {
      const array = Java.array("int", []);
      const decoder = new ArrayDecoder({ type: "[I", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(array as unknown as Java.Wrapper)).toEqual({ type: "[I", value: [] });
    });

    it("decodes an object array of Strings via the resolved element decoder", () => {
      const array = Java.array("java.lang.String", ["a", "b"]);
      const decoder = new ArrayDecoder({ type: "[Ljava.lang.String;", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(array as unknown as Java.Wrapper)).toEqual({ type: "[Ljava.lang.String;", value: ["a", "b"] });
    });

    it("decodes an array of reference-type elements by delegating to a decoder resolved per element", () => {
      // java.lang.Object has no registered class/interface decoder, so each element goes through
      // ReferenceTypeDecoder's ToStringDecoder fallback (see ReferenceTypeDecoder.test.ts branch 7) -
      // this is the array-of-complex-objects case ArrayDecoder's own element-resolution branch exists for.
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

    it("decodes a nested array by resolving another ArrayDecoder for the element type (regression)", () => {
      // the JNI-style element signature for an int[][] element is itself "[I" - elementTypeFromSignature()
      // must keep it as-is (rather than trying to map it like a primitive/object signature) so
      // JavaDecoderResolver routes back into ArrayDecoder for the inner dimension.
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
  });
});

export {};
