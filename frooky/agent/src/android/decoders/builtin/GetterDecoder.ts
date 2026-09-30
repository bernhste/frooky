import type Java from "frida-java-bridge";
import { Decodable } from "../../../shared/decoders/decodable";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { RecursiveDecoder } from "../../../shared/decoders/recursiveDecoder";
import { DecoderSettings } from "../../../shared/frookySettings";
import { decodeGetterValues, GetterOptions } from "../utils/decodeGetterValues";

// With `decoder: getters`: the `get*()` and `is*()` getters of the runtime class and its superclasses.
const DEFAULT_OPTIONS: GetterOptions = { prefixes: ["get", "is"], inherited: true };

export class GetterDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName: string = "GetterDecoder";
  readonly description: string = "Decodes an object by calling its public, no-argument `get*()` and `is*()` methods, including inherited ones.";

  private readonly options: GetterOptions;

  constructor(decodable: Decodable, options: GetterOptions = DEFAULT_OPTIONS) {
    super(decodable);
    this.options = options;
  }

  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: decodeGetterValues(value, childSettings, this.options),
    };
  }
}
