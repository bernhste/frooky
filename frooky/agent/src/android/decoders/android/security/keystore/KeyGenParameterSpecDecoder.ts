import Java from "frida-java-bridge";
import { RecursiveDecoder } from "../../../../../shared/decoders/recursiveDecoder";
import { DecoderSettings } from "../../../../../shared/frookySettings";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { decodeGetterValues } from "../../../utils/decodeGetterValues";

export class KeyGenParameterSpecDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "KeyGenParameterSpecDecoder";
  readonly description = "Decodes a `KeyGenParameterSpec` through its `get*()` and `is*()` methods (key alias, size, purposes, ...).";

  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: decodeGetterValues(value, ["get", "is"], childSettings),
    };
  }
}
