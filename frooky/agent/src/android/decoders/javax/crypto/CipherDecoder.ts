import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { chosenProviderName, constantName } from "../../utils/cryptoEngines";
import { decodeFields, javaBytesToHex, useJavaClass } from "../../utils/javaValues";

const OPMODES = ["ENCRYPT_MODE", "DECRYPT_MODE", "WRAP_MODE", "UNWRAP_MODE"];

// See cryptoEngines.ts for why only initialized ciphers show their provider, IV and block size.
export class CipherDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "CipherDecoder";
  readonly description =
    "Decodes a `javax.crypto.Cipher`: transformation, and once initialized its mode, provider, IV (as hex) and block size, without choosing a provider.";

  decode(value: Java.Wrapper): DecodedValue {
    if (value == null) return { type: this.type, name: this.name, value: null };
    const Cipher = useJavaClass("javax.crypto.Cipher");
    const cipher = Java.cast(value, Cipher);
    const initialized: boolean = cipher.initialized.value;
    const hasSpi = cipher.spi.value != null;
    return {
      type: this.type,
      name: this.name,
      value: decodeFields(this.type, {
        algorithm: () => cipher.getAlgorithm(),
        initialized: () => initialized,
        opmode: () => (initialized ? constantName(Cipher, OPMODES, cipher.opmode.value) : null),
        provider: () => chosenProviderName(cipher),
        iv: () => (initialized ? javaBytesToHex(cipher.getIV(), this.settings.maxItems) : null),
        blockSize: () => (hasSpi ? cipher.getBlockSize() : null),
      }),
    };
  }
}
