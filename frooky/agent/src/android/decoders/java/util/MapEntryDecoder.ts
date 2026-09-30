import Java from "frida-java-bridge";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { RecursiveDecoder } from "../../../../shared/decoders/recursiveDecoder";
import { DecoderSettings } from "../../../../shared/frookySettings";
import { decodeNested, useJavaClass } from "../../utils/javaValues";

export class MapEntryDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "MapEntryDecoder";
  readonly description = "Decodes a `java.util.Map.Entry` into its key and value.";

  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings): DecodedValue {
    const entry = Java.cast(value, useJavaClass("java.util.Map$Entry"));
    return {
      type: this.type,
      name: this.name,
      value: [decodeNested(entry.getKey(), "key", childSettings), decodeNested(entry.getValue(), "value", childSettings)],
    };
  }
}
