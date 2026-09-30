import type Java from "frida-java-bridge";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { RecursiveDecoder } from "../../../../../shared/decoders/recursiveDecoder";
import { DecoderSettings } from "../../../../../shared/frookySettings";
import { decodeGetterValues } from "../../../utils/decodeGetterValues";

// The specs have no common getters, so the ones of the runtime class are called, e.g. getIV() and getTLen() of
// GCMParameterSpec, or getPassword(), getSalt() and getIterationCount() of PBEKeySpec.
export class SpecDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "SpecDecoder";
  readonly description =
    "Decodes an `AlgorithmParameterSpec` or `KeySpec` (IvParameterSpec, GCMParameterSpec, PBEKeySpec, ...) through its getters, with `byte[]` as hex and `char[]` as text.";

  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: decodeGetterValues(value, childSettings, { prefixes: ["get", "is"], inherited: true, compactArrays: true }),
    };
  }
}
