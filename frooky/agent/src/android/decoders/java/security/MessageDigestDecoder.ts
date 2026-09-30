import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { chosenProviderName } from "../../utils/cryptoEngines";
import { decodeFields, useJavaClass } from "../../utils/javaValues";

export class MessageDigestDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "MessageDigestDecoder";
  readonly description = "Decodes a `java.security.MessageDigest`: algorithm, provider and digest length in bytes.";

  decode(value: Java.Wrapper): DecodedValue {
    if (value == null) return { type: this.type, name: this.name, value: null };
    const digest = Java.cast(value, useJavaClass("java.security.MessageDigest"));
    return {
      type: this.type,
      name: this.name,
      value: decodeFields(this.type, {
        algorithm: () => digest.getAlgorithm(),
        // chosen by getInstance()
        provider: () => chosenProviderName(digest),
        digestLength: () => digest.getDigestLength(),
      }),
    };
  }
}
