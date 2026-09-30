import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { ReferenceTypeDecoder } from "../../builtin/ReferenceTypeDecoder";
import { MapEntryDecoder } from "./MapEntryDecoder";

describe("MapEntryDecoder", () => {
  it("decodes the key and the value by their runtime classes", () => {
    const entry = Java.use("java.util.AbstractMap$SimpleEntry").$new("token", Java.use("java.lang.Integer").$new(42));
    const decoder = new MapEntryDecoder({ type: "java.util.AbstractMap$SimpleEntry", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(entry)).toEqual({
      type: "java.util.AbstractMap$SimpleEntry",
      value: [
        { type: "java.lang.String", name: "key", value: "token" },
        { type: "java.lang.Integer", name: "value", value: "42" },
      ],
    });
  });

  it("decodes a null value", () => {
    const entry = Java.use("java.util.AbstractMap$SimpleEntry").$new("token", null);
    const decoder = new MapEntryDecoder({ type: "java.util.Map$Entry", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(entry).value).toEqual([
      { type: "java.lang.String", name: "key", value: "token" },
      { type: "null", name: "value", value: null },
    ]);
  });

  it("is chosen for the entries of a map", () => {
    const map = Java.use("java.util.HashMap").$new();
    map.put("k", "v");
    const entry = map.entrySet().iterator().next();
    const decoder = new ReferenceTypeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(entry).value).toEqual({
      type: "java.util.HashMap$Node",
      value: [
        { type: "java.lang.String", name: "key", value: "k" },
        { type: "java.lang.String", name: "value", value: "v" },
      ],
    });
  });
});
