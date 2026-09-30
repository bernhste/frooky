import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { decodeFields, javaBytesToHex, useJavaClass } from "../../utils/javaValues";

// Keys of the Android Keystore have no encoding (`encoded` is null), their material never leaves the keystore.
export class KeyDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "KeyDecoder";
  readonly description =
    "Decodes any `java.security.Key` (SecretKey, PublicKey, PrivateKey): its algorithm, encoding format and encoded key material as hex, up to `maxItems` bytes.";

  decode(value: Java.Wrapper): DecodedValue {
    if (value == null) return { type: this.type, name: this.name, value: null };
    const key = Java.cast(value, useJavaClass("java.security.Key"));
    return {
      type: this.type,
      name: this.name,
      value: decodeFields(this.type, {
        algorithm: () => key.getAlgorithm(),
        format: () => key.getFormat(),
        encoded: () => javaBytesToHex(key.getEncoded(), this.settings.maxItems),
      }),
    };
  }
}
