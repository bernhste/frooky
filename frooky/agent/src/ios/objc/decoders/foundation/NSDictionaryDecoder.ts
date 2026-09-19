import ObjC from "frida-objc-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { ObjcReferenceDecoder } from "../builtin/ObjcReferenceDecoder";

/**
 * Decodes `NSDictionary` (and subclasses such as `NSMutableDictionary`) as object.
 *
 * - The keys are decoded using their `-description`, as a JavaScript object only has string keys.
 * - The values are decoded by their runtime class, so nested dictionaries and `NSData` values are decoded as well.
 * - Decodes at most `decodeLimit` entries and nests at most `maxRecursion` levels deep. What exceeds the limits is decoded as its `-description`.
 */
export class NSDictionaryDecoder extends Decoder<NativePointer> {
  decode(value: NativePointer): DecodedValue {
    if (value.isNull()) {
      return { type: this.type, name: this.name, value: null };
    }

    const dictionary = new ObjC.Object(value);
    const keys = dictionary.allKeys();
    const count = Number(String(keys.count()));

    // nesting limit reached, do not decode the entries
    if (this.settings.maxRecursion <= 0) {
      return { type: this.type, name: this.name, value: `<${dictionary.$className} count=${count}>` };
    }

    const nestedSettings = { ...this.settings, maxRecursion: this.settings.maxRecursion - 1 };
    const entries: Record<string, unknown> = {};
    const readCount = Math.min(count, this.settings.decodeLimit);
    for (let i = 0; i < readCount; i++) {
      const key = keys.objectAtIndex_(i);
      const entry = dictionary.objectForKey_(key);
      const valueDecoder = new ObjcReferenceDecoder({ type: "id", settings: nestedSettings });
      entries[String(key)] = valueDecoder.decode(entry ? entry.handle : NULL).value;
    }
    if (count > readCount) {
      entries["..."] = `${count - readCount} more`;
    }

    return { type: this.type, name: this.name, value: entries };
  }
}
