import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { chosenProviderName, constantName } from "../../utils/cryptoEngines";
import { decodeFields, useJavaClass } from "../../utils/javaValues";

const STATES = ["UNINITIALIZED", "SIGN", "VERIFY"];

// See cryptoEngines.ts for why the provider is read from the field.
export class SignatureDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "SignatureDecoder";
  readonly description = "Decodes a `java.security.Signature`: algorithm, state (`SIGN`, `VERIFY`, ...) and provider, without choosing a provider.";

  decode(value: Java.Wrapper): DecodedValue {
    if (value == null) return { type: this.type, name: this.name, value: null };
    const Signature = useJavaClass("java.security.Signature");
    const signature = Java.cast(value, Signature);
    return {
      type: this.type,
      name: this.name,
      value: decodeFields(this.type, {
        algorithm: () => signature.getAlgorithm(),
        state: () => constantName(Signature, STATES, signature.state.value),
        provider: () => chosenProviderName(signature),
      }),
    };
  }
}
