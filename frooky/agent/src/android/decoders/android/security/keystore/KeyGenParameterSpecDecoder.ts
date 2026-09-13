import Java from "frida-java-bridge";
import { Decoder } from "../../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { decodePublicMethodValues } from "../../../javaGetMethods";

const KEY_GEN_PARAMETER_SPEC_CLASS = "android.security.keystore.KeyGenParameterSpec";

export class KeyGenParameterSpecDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    const typedSpec = Java.cast(value, Java.use(KEY_GEN_PARAMETER_SPEC_CLASS));

    return {
      type: this.decodable.type,
      name: this.decodable.name,
      value: decodePublicMethodValues(typedSpec, KEY_GEN_PARAMETER_SPEC_CLASS, ["get", "is"], this.decodable.settings, true),
    };
  }
}
