import Java from "frida-java-bridge";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../../../shared/defaultValues";
import { ClipDataItemDecoder } from "./ClipDataItemDecoder";

describe("ClipDataItemDecoder", () => {
  const Item = Java.use("android.content.ClipData$Item");
  const Intent = Java.use("android.content.Intent");
  const Uri = Java.use("android.net.Uri");
  const decoder = new ClipDataItemDecoder({
    type: "android.content.ClipData.Item",
    settings: DEFAULT_DECODER_SETTINGS,
  });

  const JavaString = Java.use("java.lang.String");
  const charSeq = (value: string): Java.Wrapper => JavaString.$new(value);

  it("should decode a text-only item", () => {
    const item = Item.$new(charSeq("hello world"));

    const result = decoder.decode(item);

    expect(result).toEqual({
      type: "android.content.ClipData.Item",
      value: { htmlText: null, text: "hello world", uri: null, intent: null },
    });
  });

  it("should decode text with an HTML representation", () => {
    const item = Item.$new(charSeq("hello world"), "<b>hello world</b>");

    const result = decoder.decode(item);

    expect(result).toEqual({
      type: "android.content.ClipData.Item",
      value: { htmlText: "<b>hello world</b>", text: "hello world", uri: null, intent: null },
    });
  });

  it("should decode a URI item", () => {
    const item = Item.$new(Uri.parse("https://mas.owasp.org"));

    const result = decoder.decode(item);

    expect(result).toEqual({
      type: "android.content.ClipData.Item",
      value: { htmlText: null, text: null, uri: "https://mas.owasp.org", intent: null },
    });
  });

  it("should decode an item carrying an Intent", () => {
    const intent = Intent.$new("android.intent.action.VIEW");
    const item = Item.$new(intent);

    const result = decoder.decode(item);

    expect(result.value.htmlText).toBeNull();
    expect(result.value.text).toBeNull();
    expect(result.value.uri).toBeNull();

    const properties = result.value.intent as DecodedValue[];
    const findProperty = (name: string): DecodedValue | undefined => properties.find((p) => p.name === name);

    expect(findProperty("action")).toEqual({ type: "java.lang.String", name: "action", value: "android.intent.action.VIEW" });
    expect(findProperty("data")).toEqual({ type: "android.net.Uri", name: "data", value: null });
    expect(findProperty("type")).toEqual({ type: "java.lang.String", name: "type", value: null });
    expect(findProperty("package")).toEqual({ type: "java.lang.String", name: "package", value: null });
    expect(findProperty("component")).toEqual({ type: "android.content.ComponentName", name: "component", value: null });
    expect(findProperty("categories")).toEqual({ type: "java.util.Set", name: "categories", value: null });
    expect(findProperty("extras")).toEqual({ type: "android.os.Bundle", name: "extras", value: null });
    expect(findProperty("flags")).toEqual({ type: "android.content.IntentFlag", name: "flags", value: [] });
  });

  it("should decode an item without an Intent as a null intent, without throwing", () => {
    const item = Item.$new(charSeq("hello world"));

    const result = decoder.decode(item);

    expect(result.value.intent).toBeNull();
  });
});

export {};
