import type Java from "frida-java-bridge";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { RecursiveDecoder } from "../../../../shared/decoders/recursiveDecoder";
import { DecoderSettings } from "../../../../shared/frookySettings";
import { decodeGetterValues } from "../../utils/decodeGetterValues";

// The implementation class belongs to the WebView package, so the getters of the interface are called.
export class WebResourceRequestDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "WebResourceRequestDecoder";
  readonly description = "Decodes an `android.webkit.WebResourceRequest`: URL, method, request headers and its is*/has* flags.";

  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: decodeGetterValues(value, childSettings, { className: "android.webkit.WebResourceRequest", prefixes: ["get", "is", "has"] }),
    };
  }
}
