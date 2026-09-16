import Java from "frida-java-bridge";
import { Decoder } from "../../../../../shared/decoders/baseDecoder";
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

export class ClipDataDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    const items: DecodedValue[] = [];

    const itemCount: number = value.getItemCount().valueOf();

    for (let i = 0; i < itemCount; i++) {
      const item = value.getItemAt(i);

      const clipDataItemDecoder = new ClipDataItemDecoder({
        type: "android.content.ClipData.Item",
        settings: this.settings,
      });

      items.push(clipDataItemDecoder.decode(item));
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
