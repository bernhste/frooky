import type { RuntimeInstance } from "frida-swift-bridge/dist/lib/types.js";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { SwiftDecoderResolver } from "../swiftDecoderResolver";

// Layout of the storage of a native Swift array on 64 bit platforms (`_ContiguousArrayStorage`):
// heap object header (metadata, reference count), then the count, the capacity, and the elements.
const COUNT_OFFSET = 16;
const ELEMENTS_OFFSET = 32;

// the count is not trusted beyond this, arrays with a different storage (e.g. bridged from `NSArray`) have another layout
const MAX_PLAUSIBLE_COUNT = 0x1000000;

/**
 * Sizes (= strides) of the element types the decoder knows how to read.
 * Class references, structs and enums with other layouts are not supported yet.
 */
const ELEMENT_STRIDES: Record<string, number> = {
  "Swift.String": 16,
  "Swift.Int": 8,
  "Swift.UInt": 8,
  "Swift.Int64": 8,
  "Swift.UInt64": 8,
  "Swift.Double": 8,
  "Swift.Int32": 4,
  "Swift.UInt32": 4,
  "Swift.Float": 4,
  "Swift.Int16": 2,
  "Swift.UInt16": 2,
  "Swift.Int8": 1,
  "Swift.UInt8": 1,
  "Swift.Bool": 1,
};

/**
 * Extracts the element type of an array type: `Swift.Array<Swift.String>` and `[Swift.String]` both result in `Swift.String`.
 * Types of the standard library can be declared without the `Swift.` prefix, which is added.
 *
 * @returns `undefined` if the type is not an array type
 */
export function parseSwiftArrayElementType(type: string): string | undefined {
  const match = /^(?:(?:Swift\.)?Array<(.+)>|\[(.+)\])$/.exec(type.trim());
  const element = match?.[1] ?? match?.[2];
  if (!element) return undefined;
  const trimmed = element.trim();
  return trimmed.includes(".") ? trimmed : `Swift.${trimmed}`;
}

/**
 * Decodes a `Swift.Array` of strings, integers, floating point numbers or booleans as array.
 * The element type is taken from the type (`Swift.Array<Swift.String>`), each element is decoded by the decoder of that type.
 * Decodes at most `decodeLimit` elements.
 */
export class SwiftArrayDecoder extends Decoder<RuntimeInstance> {
  decode(value: RuntimeInstance): DecodedValue {
    return { type: this.type, name: this.name, value: this.readArray(value.handle) };
  }

  private readArray(handle: NativePointer): unknown {
    const elementType = parseSwiftArrayElementType(this.type);
    const stride = elementType ? ELEMENT_STRIDES[elementType] : undefined;
    if (!elementType || !stride) {
      return `<unsupported array element type '${elementType ?? this.type}'>`;
    }

    // a Swift.Array is a single reference to its storage
    const storage = handle.readPointer();
    const count = Number(storage.add(COUNT_OFFSET).readU64().toString());
    if (count > MAX_PLAUSIBLE_COUNT) {
      return "<unsupported array storage>";
    }

    const elementDecoder = SwiftDecoderResolver.resolveDecoder({ type: elementType, settings: { ...this.settings, decoder: undefined } });
    const readCount = Math.min(count, this.settings.decodeLimit);
    const elements: unknown[] = [];
    for (let i = 0; i < readCount; i++) {
      // the element decoders only need to know where the value is stored
      const element = { handle: storage.add(ELEMENTS_OFFSET + i * stride) } as RuntimeInstance;
      elements.push(elementDecoder.decode(element).value);
    }
    if (count > readCount) {
      elements.push("...");
    }
    return elements;
  }
}
