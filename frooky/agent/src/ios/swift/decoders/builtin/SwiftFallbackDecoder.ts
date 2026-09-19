import type { RuntimeInstance } from "frida-swift-bridge/dist/lib/types.js";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

/** Decodes every value without a dedicated decoder as the address of its memory. */
export class SwiftFallbackDecoder extends Decoder<RuntimeInstance> {
  decode(value: RuntimeInstance): DecodedValue {
    return { type: this.type, name: this.name, value: value?.handle ? value.handle.toString() : null };
  }
}
