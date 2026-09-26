import Java from "frida-java-bridge";
import { MAX_DEPTH_MARKER } from "../../../../shared/decoders/recursiveDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { MapDecoder } from "./MapDecoder";

describe("MapDecoder", () => {
  describe("decode()", () => {
    it("should decode the key set and value collection of a java.util.Map", () => {
      const HashMap = Java.use("java.util.HashMap");
      const map = HashMap.$new();
      map.put("a", "1");

      // keySet()/values() return their own runtime view classes (e.g. HashMap$KeySet), which
      // is JVM/ART-implementation-specific - read it dynamically instead of hardcoding a guess
      const keySetClassName = map.keySet().$className;
      const valuesClassName = map.values().$className;

      const decoder = new MapDecoder({ type: "java.util.Map", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(map);

      expect(result).toEqual({
        type: "java.util.Map",
        value: [
          { type: keySetClassName, name: "key", value: [{ type: "java.lang.String", value: "a" }] },
          { type: valuesClassName, name: "value", value: [{ type: "java.lang.String", value: "1" }] },
        ],
      });
    });

    it("should decode an empty map to empty key and value collections", () => {
      const HashMap = Java.use("java.util.HashMap");
      const map = HashMap.$new();

      const keySetClassName = map.keySet().$className;
      const valuesClassName = map.values().$className;

      const decoder = new MapDecoder({ type: "java.util.Map", settings: DEFAULT_DECODER_SETTINGS });
      const result = decoder.decode(map);

      expect(result).toEqual({
        type: "java.util.Map",
        value: [
          { type: keySetClassName, name: "key", value: [] },
          { type: valuesClassName, name: "value", value: [] },
        ],
      });
    });

    it("should decode the keys and values one level below the map (maxDepth)", () => {
      const HashMap = Java.use("java.util.HashMap");
      const ArrayList = Java.use("java.util.ArrayList");
      const map = HashMap.$new();
      map.put("a", ArrayList.$new());

      const decoder = new MapDecoder({ type: "java.util.Map", settings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 1 } });
      const [keys, values] = decoder.decode(map).value as DecodedValue[];

      // keys are leaves and always decoded, the list value is a container one level too deep
      expect(keys.value).toEqual([{ type: "java.lang.String", value: "a" }]);
      expect(values.value).toEqual([{ type: "java.util.ArrayList", value: { type: "java.util.ArrayList", value: MAX_DEPTH_MARKER } }]);
    });

    it("should return a max depth marker instead of the map when maxDepth is used up", () => {
      const map = Java.use("java.util.HashMap").$new();
      map.put("a", "1");

      const decoder = new MapDecoder({ type: "java.util.Map", settings: { ...DEFAULT_DECODER_SETTINGS, maxDepth: 0 } });

      expect(decoder.decode(map)).toEqual({ type: "java.util.Map", value: MAX_DEPTH_MARKER });
    });
  });
});
