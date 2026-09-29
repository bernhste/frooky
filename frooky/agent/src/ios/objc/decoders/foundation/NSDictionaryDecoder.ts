import ObjC from "frida-objc-bridge";
import { RecursiveDecoder } from "../../../../shared/decoders/recursiveDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../../../shared/frookySettings";
import { ObjcReferenceDecoder } from "../builtin/ObjcReferenceDecoder";

// Keys are decoded as their `-description`, since a JSON object only has string keys. Values are decoded by
// their runtime class, so nested dictionaries and NSData values are decoded as well.
export class NSDictionaryDecoder extends RecursiveDecoder<NativePointer> {
  readonly decoderName = "NSDictionaryDecoder";
  readonly description = "Decodes an `NSDictionary` (or a subclass) as an object, up to `maxItems` entries.";

  // childSettings only depend on this.settings, so the value decoder is created once
  private valueDecoder: ObjcReferenceDecoder | null = null;

  public decode(value: NativePointer, arg?: any): DecodedValue {
    // checked before the depth limit, so null is never reported as truncated
    if (value.isNull()) {
      return { type: this.type, name: this.name, value: null };
    }
    return super.decode(value, arg);
  }

  protected decodeRecursive(value: NativePointer, childSettings: DecoderSettings): DecodedValue {
    const valueDecoder = (this.valueDecoder ??= new ObjcReferenceDecoder({ type: "id", settings: childSettings }));
    const dictionary = new ObjC.Object(value);
    const keys = dictionary.allKeys();
    const count = Number(String(keys.count()));
    const maxItems = this.settings.maxItems;

    const entries: Record<string, unknown> = {};
    const readCount = Math.min(count, maxItems);
    for (let i = 0; i < readCount; i++) {
      const key = keys.objectAtIndex_(i);
      const entry = dictionary.objectForKey_(key);
      entries[String(key)] = valueDecoder.decode(entry ? entry.handle : NULL).value;
    }
    if (count > readCount) {
      entries["..."] = `[truncated at ${maxItems}]`;
    }

    return { type: this.type, name: this.name, value: entries };
  }
}
