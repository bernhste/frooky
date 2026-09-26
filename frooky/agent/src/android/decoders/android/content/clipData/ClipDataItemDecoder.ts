import Java from "frida-java-bridge";
import { RecursiveDecoder } from "../../../../../shared/decoders/recursiveDecoder";
import { DecoderSettings } from "../../../../../shared/frookySettings";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { IntentDecoder } from "../IntentDecoder";

export class ClipDataItemDecoder extends RecursiveDecoder<Java.Wrapper> {
  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings): DecodedValue {
    const htmlText = value.getHtmlText();
    const text = value.getText();
    const uri = value.getUri();

    const intentValue = value.getIntent();
    const intent =
      intentValue != null ? new IntentDecoder({ type: "android.content.Intent", settings: childSettings }).decode(intentValue).value : null;

    return {
      type: "android.content.ClipData.Item",
      value: {
        htmlText: htmlText != null ? htmlText.toString() : null,
        text: text != null ? text.toString() : null,
        uri: uri != null ? uri.toString() : null,
        intent,
      },
    };
  }
}
