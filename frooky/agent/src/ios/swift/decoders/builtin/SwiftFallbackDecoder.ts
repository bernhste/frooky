import type { RuntimeInstance } from "frida-swift-bridge/dist/lib/types.js";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";

export class SwiftFallbackDecoder extends Decoder<RuntimeInstance> {
  readonly decoderName = "SwiftFallbackDecoder";
  readonly description = "Used for Swift types frooky does not know: outputs the address of the value's memory.";

  decode(value: RuntimeInstance): DecodedValue {
    return { type: this.type, name: this.name, value: value?.handle ? value.handle.toString() : null };
  }
}
