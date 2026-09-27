import Java from "frida-java-bridge";
import { RecursiveDecoder } from "../../../../../shared/decoders/recursiveDecoder";
import { DecoderSettings } from "../../../../../shared/frookySettings";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { ClipDataItemDecoder } from "./ClipDataItemDecoder";

function decodeDescription(description: Java.Wrapper): { label: string | null; mimeTypes: string[] } {
  const label = description.getLabel();
  const mimeTypeCount: number = description.getMimeTypeCount();
  const mimeTypes: string[] = [];
  for (let i = 0; i < mimeTypeCount; i++) {
    mimeTypes.push(description.getMimeType(i).toString());
  }

  return {
    label: label != null ? label.toString() : null,
    mimeTypes,
  };
}

export class ClipDataDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "ClipDataDecoder";
  readonly description = "Decodes `android.content.ClipData`: its label, MIME types and items, up to `maxItems` items.";

  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings): DecodedValue {
    const items: DecodedValue[] = [];

    const itemCount: number = value.getItemCount().valueOf();
    const maxItems = this.settings.maxItems;
    const decodeLen = Math.min(itemCount, maxItems);

    const clipDataItemDecoder = new ClipDataItemDecoder({
      type: "android.content.ClipData.Item",
      settings: childSettings,
    });

    for (let i = 0; i < decodeLen; i++) {
      items.push(clipDataItemDecoder.decode(value.getItemAt(i)));
    }
    if (itemCount > decodeLen) {
      items.push({ type: "java.lang.String", value: `[truncated at ${maxItems}]` });
    }

    return {
      type: "android.content.ClipData",
      value: {
        description: decodeDescription(value.getDescription()),
        itemCount: itemCount,
        items: items,
      },
    };
  }
}
