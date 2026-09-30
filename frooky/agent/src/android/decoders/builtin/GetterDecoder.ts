import type Java from "frida-java-bridge";
import { RecursiveDecoder } from "../../../shared/decoders/recursiveDecoder";
import { DecoderSettings } from "../../../shared/frookySettings";
import { Decodable } from "../../../shared/decoders/decodable";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { decodeGetterValues } from "../utils/decodeGetterValues";

export class GetterDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "GetterDecoder";
  readonly description = "Decodes an object by calling its public, no-argument `get*()` methods.";

  // the class whose getters are called, by default the runtime class of the value
  private readonly reflectedClass?: string;

  constructor(decodable: Decodable, reflectedClass?: string) {
    super(decodable);
    this.reflectedClass = reflectedClass;
  }

  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: decodeGetterValues(value, ["get"], childSettings, this.reflectedClass),
    };
  }
}
