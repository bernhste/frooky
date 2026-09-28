import Java from "frida-java-bridge";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { MAX_DEPTH_MARKER } from "../../../../shared/decoders/recursiveDecoder";
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

    it("should resolve the decoder per element runtime class", () => {
      const ArrayList = Java.use("java.util.ArrayList");
      const list = ArrayList.$new();
      list.add("a");

      const objectElement = Java.use("java.lang.Object").$new();
      list.add(objectElement);

      const decoder = new IterableDecoder({ type: "java.util.List", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(list);

      // the second element is a java.lang.Object, not a java.lang.String like the first one
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

      expect(resolveDecoderSpy.mock.calls.length).toBe(1);
      resolveDecoderSpy.mockRestore();
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

      // one for java.lang.String, one for java.lang.Object (decoded via toString(), no nested resolve)
      expect(resolveDecoderSpy.mock.calls.length).toBe(2);
      resolveDecoderSpy.mockRestore();
    });

    it("should truncate at maxItems and append a truncation marker", () => {
      const ArrayList = Java.use("java.util.ArrayList");
      const list = ArrayList.$new();
      list.add("a");
      list.add("b");
      list.add("c");

      const decoder = new IterableDecoder({
        type: "java.util.List",
        settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 2 },
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

    it("should replace a nested collection with a max depth marker once maxDepth is used up", () => {
      const ArrayList = Java.use("java.util.ArrayList");
      const inner = ArrayList.$new();
      inner.add("a");
      const outer = ArrayList.$new();
      outer.add(inner);

      const decoder = new IterableDecoder({ type: "java.util.List", settings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 1 } });
      const result = decoder.decode(outer);

      expect(result).toEqual({
        type: "java.util.List",
        value: [{ type: "java.util.ArrayList", value: { type: "java.util.ArrayList", value: MAX_DEPTH_MARKER } }],
      });
    });

    it("should decode a nested collection when maxDepth allows it", () => {
      const ArrayList = Java.use("java.util.ArrayList");
      const inner = ArrayList.$new();
      inner.add("a");
      const outer = ArrayList.$new();
      outer.add(inner);

      const decoder = new IterableDecoder({ type: "java.util.List", settings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 2 } });
      const result = decoder.decode(outer);

      expect(result).toEqual({
        type: "java.util.List",
        value: [{ type: "java.util.ArrayList", value: { type: "java.util.ArrayList", value: [{ type: "java.lang.String", value: "a" }] } }],
      });
    });
  });
});
