import Java from "frida-java-bridge";
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
  });
});
