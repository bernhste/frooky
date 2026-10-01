import Java from "frida-java-bridge";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { ReferenceTypeDecoder } from "../../builtin/ReferenceTypeDecoder";
import { registerTestClass } from "../../utils/registerTestClass";

let fakeRequestClass: Java.Wrapper | undefined;
// WebView creates the real implementation, so the test implements the interface itself
function fakeRequest(): Java.Wrapper {
  fakeRequestClass ??= registerTestClass({
    name: "frooky.test.FakeWebResourceRequest",
    implements: [Java.use("android.webkit.WebResourceRequest")],
    methods: {
      getUrl: () => Java.use("android.net.Uri").parse("https://example.org/api"),
      isForMainFrame: () => true,
      isRedirect: () => false,
      hasGesture: () => false,
      getMethod: () => "POST",
      getRequestHeaders: () => {
        const headers = Java.use("java.util.HashMap").$new();
        headers.put("Authorization", "Bearer abc");
        return headers;
      },
    },
  });
  return fakeRequestClass.$new();
}

describe("WebResourceRequestDecoder", () => {
  it("decodes URL, method, headers and flags of a request declared as the interface", () => {
    const decoder = new ReferenceTypeDecoder({ type: "android.webkit.WebResourceRequest", settings: DEFAULT_DECODER_SETTINGS });

    const properties = (decoder.decode(fakeRequest()).value as DecodedValue).value as DecodedValue[];
    const byName = Object.fromEntries(properties.map((property) => [property.name, property]));

    expect(byName.method.value).toBe("POST");
    expect(byName.url.value).toEqual({ type: "android.net.Uri$StringUri", name: "url", value: "https://example.org/api" });
    expect(byName.forMainFrame.value).toBe(true);
    expect(byName.redirect.value).toBe(false);
    expect(byName.gesture.value).toBe(false);
    const headers = byName.requestHeaders.value as DecodedValue;
    expect(JSON.stringify(headers)).toContain("Bearer abc");
  });
});
