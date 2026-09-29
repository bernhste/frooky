import type { RuntimeInstance } from "frida-swift-bridge/dist/lib/types.js";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { RecursiveDecoder } from "../../../../shared/decoders/recursiveDecoder";
import { DecoderSettings } from "../../../../shared/frookySettings";
import { SwiftDecoderResolver } from "../swiftDecoderResolver";

// Layout of the storage of a native Swift array on 64-bit platforms (`_ContiguousArrayStorage`): the heap
// object header (metadata, reference count), then the count, the capacity, and the elements.
const COUNT_OFFSET = 16;
const ELEMENTS_OFFSET = 32;

// arrays with another storage (e.g. bridged from `NSArray`) have another layout, so a larger count is not trusted
const MAX_PLAUSIBLE_COUNT = 0x1000000;

// Sizes (strides) of the element types that can be read. Class references, and structs and enums with other
// layouts are not supported.
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

// The element type of an array type, e.g. `Swift.Array<Swift.String>` or `[String]` -> `Swift.String`. The
// `Swift.` module is added to standard library types declared without it. undefined if it isn't an array type.
export function parseSwiftArrayElementType(type: string): string | undefined {
  const match = /^(?:(?:Swift\.)?Array<(.+)>|\[(.+)\])$/.exec(type.trim());
  const element = match?.[1] ?? match?.[2];
  if (!element) return undefined;
  const trimmed = element.trim();
  return trimmed.includes(".") ? trimmed : `Swift.${trimmed}`;
}

export class SwiftArrayDecoder extends RecursiveDecoder<RuntimeInstance> {
  readonly decoderName = "SwiftArrayDecoder";
  readonly description =
    "Decodes a `Swift.Array` of strings, integers, floating point numbers or booleans element by element, up to `maxItems` elements.";

  // childSettings only depend on this.settings, so the element decoder is resolved once
  private elementDecoder: Decoder<RuntimeInstance> | null = null;

  protected decodeRecursive(value: RuntimeInstance, childSettings: DecoderSettings): DecodedValue {
    return { type: this.type, name: this.name, value: this.readArray(value.handle, childSettings) };
  }

  private readArray(handle: NativePointer, childSettings: DecoderSettings): unknown {
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

    // a custom decoder (e.g. `decoder: array`) only applies to the array itself
    const elementDecoder = (this.elementDecoder ??= SwiftDecoderResolver.resolveDecoder({
      type: elementType,
      settings: { ...childSettings, decoder: undefined },
    }));
    const maxItems = this.settings.maxItems;
    const readCount = Math.min(count, maxItems);
    const elements: unknown[] = new Array(readCount);
    for (let i = 0; i < readCount; i++) {
      // the element decoders only read from the handle
      const element = { handle: storage.add(ELEMENTS_OFFSET + i * stride) } as RuntimeInstance;
      elements[i] = elementDecoder.decode(element).value;
    }
    if (count > readCount) {
      elements.push(`[truncated at ${maxItems}]`);
    }
    return elements;
  }
}
