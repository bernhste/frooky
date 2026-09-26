import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { ContentValuesDecoder } from "./ContentValuesDecoder";

describe("ContentValuesDecoder", () => {
  const ContentValues = Java.use("android.content.ContentValues");
  const decoder = new ContentValuesDecoder({ type: "android.content.ContentValues", settings: DEFAULT_DECODER_SETTINGS });

  it("should decode every key/value pair to its string representation", () => {
    const values = ContentValues.$new();
    values.put("name", "Alice");
    values.put("city", "Zurich");

    const result = decoder.decode(values);

    expect(result).toEqual({
      type: "android.content.ContentValues",
      value: { name: "Alice", city: "Zurich" },
    });
  });

  it("should decode a null value without throwing", () => {
    const values = ContentValues.$new();
    values.putNull("key");

    const result = decoder.decode(values);

    expect(result).toEqual({ type: "android.content.ContentValues", value: { key: null } });
  });

  it("should decode an empty ContentValues to an empty object", () => {
    const values = ContentValues.$new();

    const result = decoder.decode(values);

    expect(result).toEqual({ type: "android.content.ContentValues", value: {} });
  });

  it("should truncate at maxItems and add a truncation marker key", () => {
    const values = ContentValues.$new();
    values.put("a", "1");
    values.put("b", "2");
    values.put("c", "3");

    const limitedDecoder = new ContentValuesDecoder({
      type: "android.content.ContentValues",
      settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 2 },
    });
    const result = limitedDecoder.decode(values).value as Record<string, unknown>;

    expect(Object.keys(result).length).toBe(3);
    expect(result["[truncated at 2]"]).toBe(null);
  });
});

export {};
