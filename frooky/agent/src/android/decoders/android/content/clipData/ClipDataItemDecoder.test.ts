import Java from "frida-java-bridge";
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
    expect(result.value.intent).toEqual({
      type: "android.content.Intent",
      value: {
        action: "android.intent.action.VIEW",
        data: null,
        type: null,
        package: null,
        component: null,
        selector: null,
        flags: { type: "android.content.IntentFlag", value: [] },
        categories: null,
        extras: null,
        clipData: null,
      },
    });
  });
});

export {};
