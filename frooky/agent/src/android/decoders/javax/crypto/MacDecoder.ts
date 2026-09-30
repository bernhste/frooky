import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { chosenProviderName } from "../../utils/cryptoEngines";
import { decodeFields, useJavaClass } from "../../utils/javaValues";

// See cryptoEngines.ts for why only a Mac with a chosen provider shows its provider and length.
export class MacDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "MacDecoder";
  readonly description = "Decodes a `javax.crypto.Mac`: algorithm, and once initialized its provider and MAC length, without choosing a provider.";

  decode(value: Java.Wrapper): DecodedValue {
    if (value == null) return { type: this.type, name: this.name, value: null };
    const mac = Java.cast(value, useJavaClass("javax.crypto.Mac"));
    const hasSpi = mac.spi.value != null;
    return {
      type: this.type,
      name: this.name,
      value: decodeFields(this.type, {
        algorithm: () => mac.getAlgorithm(),
        initialized: () => mac.initialized.value,
        provider: () => chosenProviderName(mac),
        macLength: () => (hasSpi ? mac.getMacLength() : null),
      }),
    };
  }
}
