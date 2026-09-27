import Java from "frida-java-bridge";
import { RecursiveDecoder } from "../../../../shared/decoders/recursiveDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

export class ContentValuesDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "ContentValuesDecoder";
  readonly description = "Decodes `android.content.ContentValues` into its column/value pairs, up to `maxItems` columns.";

  protected decodeRecursive(value: Java.Wrapper): DecodedValue {
    const result: Record<string, unknown> = {};

    const keys = value.keySet().toArray();
    const maxItems = this.settings.maxItems;
    const decodeLen = Math.min(keys.length, maxItems);

    for (let i = 0; i < decodeLen; i++) {
      const key = keys[i].toString();
      const val = value.get(key);
      result[key] = val != null ? val.toString() : null;
    }
    // the value is a key/value object, so the truncation marker becomes a key of its own
    if (keys.length > decodeLen) {
      result[`[truncated at ${maxItems}]`] = null;
    }

    return {
      type: "android.content.ContentValues",
      value: result,
    };
  }
}
