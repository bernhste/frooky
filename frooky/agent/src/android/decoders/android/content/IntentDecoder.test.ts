import Java from "frida-java-bridge";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { IntentDecoder } from "./IntentDecoder";

describe("IntentDecoder", () => {
  const Intent = Java.use("android.content.Intent");
  const decoder = new IntentDecoder({ type: "android.content.Intent", settings: DEFAULT_DECODER_SETTINGS });

  function findProperty(result: DecodedValue, name: string): DecodedValue | undefined {
    return (result.value as DecodedValue[]).find((property) => property.name === name);
  }

  it("should decode a bare intent's properties as null/empty", () => {
    const intent = Intent.$new();

    const result = decoder.decode(intent);

    expect(result.type).toBe("android.content.Intent");
    expect(findProperty(result, "action")).toEqual({ type: "java.lang.String", name: "action", value: null });
    expect(findProperty(result, "data")).toEqual({ type: "android.net.Uri", name: "data", value: null });
    expect(findProperty(result, "type")).toEqual({ type: "java.lang.String", name: "type", value: null });
    expect(findProperty(result, "package")).toEqual({ type: "java.lang.String", name: "package", value: null });
    expect(findProperty(result, "component")).toEqual({ type: "android.content.ComponentName", name: "component", value: null });
    expect(findProperty(result, "categories")).toEqual({ type: "java.util.Set", name: "categories", value: null });
    expect(findProperty(result, "extras")).toEqual({ type: "android.os.Bundle", name: "extras", value: null });
    expect(findProperty(result, "flags")).toEqual({ type: "android.content.IntentFlag", name: "flags", value: [] });
  });

  it("should decode action, type and package as plain strings", () => {
    const intent = Intent.$new("android.intent.action.VIEW");
    intent.setType("text/plain");
    intent.setPackage("com.example.target");

    const result = decoder.decode(intent);

    expect(findProperty(result, "action")).toEqual({ type: "java.lang.String", name: "action", value: "android.intent.action.VIEW" });
    expect(findProperty(result, "type")).toEqual({ type: "java.lang.String", name: "type", value: "text/plain" });
    expect(findProperty(result, "package")).toEqual({ type: "java.lang.String", name: "package", value: "com.example.target" });
  });

  it("should decode data and component via their own toString()", () => {
    const intent = Intent.$new();
    intent.setData(Java.use("android.net.Uri").parse("https://example.com/path"));
    intent.setComponent(Java.use("android.content.ComponentName").$new("com.example.target", "com.example.target.MainActivity"));

    const result = decoder.decode(intent);

    const data = findProperty(result, "data");
    expect(data?.type).toBe("android.net.Uri");
    expect((data?.value as DecodedValue).value).toBe("https://example.com/path");

    const component = findProperty(result, "component");
    expect(component?.type).toBe("android.content.ComponentName");
    expect((component?.value as DecodedValue).value).toBe("ComponentInfo{com.example.target/com.example.target.MainActivity}");
  });

  it("should decode every category added to the intent", () => {
    const intent = Intent.$new();
    intent.addCategory("android.intent.category.DEFAULT");
    intent.addCategory("android.intent.category.BROWSABLE");

    const result = decoder.decode(intent);

    const categories = findProperty(result, "categories");
    const items = (categories?.value as DecodedValue).value as DecodedValue[];
    const names = items.map((item) => item.value);

    expect(names).toContain("android.intent.category.DEFAULT");
    expect(names).toContain("android.intent.category.BROWSABLE");
    expect(names.length).toBe(2);
  });

  it("should decode flags to their human-readable FLAG_* names", () => {
    const intent = Intent.$new();
    const flagNewTask: number = Intent.FLAG_ACTIVITY_NEW_TASK.value;
    const flagSingleTop: number = Intent.FLAG_ACTIVITY_SINGLE_TOP.value;
    intent.setFlags(flagNewTask | flagSingleTop);

    const result = decoder.decode(intent);

    const flags = findProperty(result, "flags");
    expect(flags?.type).toBe("android.content.IntentFlag");
    expect(flags?.value).toContain("FLAG_ACTIVITY_NEW_TASK");
    expect(flags?.value).toContain("FLAG_ACTIVITY_SINGLE_TOP");
  });

  it("should decode the intent's extras as a Bundle", () => {
    const intent = Intent.$new();
    intent.putExtra("greeting", "hello world");

    const result = decoder.decode(intent);

    const extras = findProperty(result, "extras");
    expect(extras?.type).toBe("android.os.Bundle");
    expect((extras?.value as DecodedValue).value).toEqual([{ type: "java.lang.String", name: "greeting", value: "hello world" }]);
  });
});

export {};
