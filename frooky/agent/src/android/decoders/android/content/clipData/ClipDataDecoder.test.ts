import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../../../shared/defaultValues";
import { ClipDataDecoder } from "./ClipDataDecoder";

describe("ClipDataDecoder", () => {
  const ClipData = Java.use("android.content.ClipData");
  const ClipDataItem = Java.use("android.content.ClipData$Item");
  const Intent = Java.use("android.content.Intent");
  const decoder = new ClipDataDecoder({
    type: "android.content.ClipData",
    settings: DEFAULT_DECODER_SETTINGS,
  });

  // ClipData's factory methods and Item's ctor take CharSequence params. Plain JS strings can't be
  // marshalled into an interface-typed parameter, so wrap them as real java.lang.String instances.
  const JavaString = Java.use("java.lang.String");
  const charSeq = (value: string): Java.Wrapper => JavaString.$new(value);
  const newPlainText = (label: string, text: string): Java.Wrapper => ClipData.newPlainText(charSeq(label), charSeq(text));
  const newIntentClip = (label: string, intent: Java.Wrapper): Java.Wrapper => ClipData.newIntent(charSeq(label), intent);
  const newTextItem = (text: string): Java.Wrapper => ClipDataItem.$new(charSeq(text));

  it("should decode the description's label and mime types", () => {
    const clip = newPlainText("my label", "hello world");

    const result = decoder.decode(clip);

    expect(result.value.description).toEqual({ label: "my label", mimeTypes: ["text/plain"] });
  });

  it("should decode a single item without double-wrapping it", () => {
    const clip = newPlainText("label", "hello world");

    const result = decoder.decode(clip);

    expect(result.value.itemCount).toBe(1);
    expect(result.value.items).toEqual([
      {
        type: "android.content.ClipData.Item",
        value: { htmlText: null, text: "hello world", uri: null, intent: null },
      },
    ]);
  });

  it("should decode every item added to the clip", () => {
    const clip = newPlainText("label", "first");
    clip.addItem(newTextItem("second"));

    const result = decoder.decode(clip);

    expect(result.value.itemCount).toBe(2);
    expect(result.value.items).toEqual([
      { type: "android.content.ClipData.Item", value: { htmlText: null, text: "first", uri: null, intent: null } },
      { type: "android.content.ClipData.Item", value: { htmlText: null, text: "second", uri: null, intent: null } },
    ]);
  });

  it("should decode a clip carrying an Intent item", () => {
    const clip = newIntentClip("label", Intent.$new("android.intent.action.VIEW"));

    const result = decoder.decode(clip);

    expect(result.value.items[0].value.intent).toEqual({
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
