import Java from "frida-java-bridge";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { JavaDecoderResolver } from "../../javaDecoderResolver";
import { IterableDecoder } from "./IterableDecoder";

describe("IterableDecoder", () => {
  describe("decode()", () => {
    it("should decode each element of a java.util.List", () => {
      const ArrayList = Java.use("java.util.ArrayList");
      const list = ArrayList.$new();
      list.add("a");
      list.add("b");

      const decoder = new IterableDecoder({ type: "java.util.List", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(list);

      expect(result).toEqual({
        type: "java.util.List",
        value: [
          { type: "java.lang.String", value: "a" },
          { type: "java.lang.String", value: "b" },
        ],
      });
    });

    it("should return an empty array for an empty iterable", () => {
      const ArrayList = Java.use("java.util.ArrayList");
      const list = ArrayList.$new();

      const decoder = new IterableDecoder({ type: "java.util.List", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(list);

      expect(result).toEqual({ type: "java.util.List", value: [] });
    });

    it("should resolve the decoder per element instead of reusing the first element's decoder (regression)", () => {
      const ArrayList = Java.use("java.util.ArrayList");
      const list = ArrayList.$new();
      list.add("a");

      const objectElement = Java.use("java.lang.Object").$new();
      list.add(objectElement);

      const decoder = new IterableDecoder({ type: "java.util.List", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(list);

      // the second element must be decoded as java.lang.Object in its own right, not
      // mislabeled as java.lang.String just because the first element resolved to it. Its exact
      // shape (JavaFallbackDecoder reflecting getClass() etc.) is JavaFallbackDecoder's concern,
      // not this decoder's, so only the outer type is asserted here.
      const values = result.value as DecodedValue[];
      expect(values[0]).toEqual({ type: "java.lang.String", value: "a" });
      expect(values[1].type).toBe("java.lang.Object");
      expect((values[1].value as DecodedValue).type).toBe("java.lang.Object");
    });

    it("should resolve the decoder only once for elements sharing the same runtime class (decoderCache)", () => {
      const ArrayList = Java.use("java.util.ArrayList");
      const list = ArrayList.$new();
      list.add("a");
      list.add("b");
      list.add("c");

      const resolveDecoderSpy = spyOn(JavaDecoderResolver, "resolveDecoder");

      const decoder = new IterableDecoder({ type: "java.util.List", settings: DEFAULT_DECODER_SETTINGS });
      decoder.decode(list);

      expect(resolveDecoderSpy.calls.length).toBe(1);
      resolveDecoderSpy.restore();
    });

    it("should resolve a new decoder once per distinct runtime class, not once per element (decoderCache)", () => {
      const ArrayList = Java.use("java.util.ArrayList");
      const list = ArrayList.$new();
      list.add("a");
      list.add(Java.use("java.lang.Object").$new());
      list.add("b"); // same class as the first element - must not trigger another resolve

      const resolveDecoderSpy = spyOn(JavaDecoderResolver, "resolveDecoder");

      const decoder = new IterableDecoder({ type: "java.util.List", settings: DEFAULT_DECODER_SETTINGS });
      decoder.decode(list);

      // one resolve for java.lang.String, one for java.lang.Object (from IterableDecoder's own
      // per-element cache), and one more nested inside JavaFallbackDecoder's decoding of the
      // Object element's getClass() property (type java.lang.Class) - not a caching regression,
      // just a real decode that only happens for the Object element
      expect(resolveDecoderSpy.calls.length).toBe(3);
      resolveDecoderSpy.restore();
    });

    it("should truncate at decodeLimit and append a truncation marker", () => {
      const ArrayList = Java.use("java.util.ArrayList");
      const list = ArrayList.$new();
      list.add("a");
      list.add("b");
      list.add("c");

      const decoder = new IterableDecoder({
        type: "java.util.List",
        settings: { ...DEFAULT_DECODER_SETTINGS, decodeLimit: 2 },
      });
      const result = decoder.decode(list);

      expect(result).toEqual({
        type: "java.util.List",
        value: [
          { type: "java.lang.String", value: "a" },
          { type: "java.lang.String", value: "b" },
          { type: "java.lang.String", value: "[truncated at 2]" },
        ],
      });
    });
  });
});
