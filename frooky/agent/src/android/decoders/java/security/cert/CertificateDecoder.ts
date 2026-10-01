import Java from "frida-java-bridge";
import { Decoder } from "../../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { decodeFields, javaBytesSha256, useJavaClass } from "../../../utils/javaValues";

// For certificates other than X.509, which has its own decoder. `sha256` is the fingerprint of the encoding.
export class CertificateDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "CertificateDecoder";
  readonly description = "Decodes a `java.security.cert.Certificate` that is not X.509: its type, public key algorithm and SHA-256 fingerprint.";

  decode(value: Java.Wrapper): DecodedValue {
    if (value == null) return { type: this.type, name: this.name, value: null };
    const certificate = Java.cast(value, useJavaClass("java.security.cert.Certificate"));
    return {
      type: this.type,
      name: this.name,
      value: decodeFields(this.type, {
        type: () => certificate.getType(),
        // the wrapper is typed as the interface PublicKey, which doesn't declare the getAlgorithm() of Key
        publicKeyAlgorithm: () => Java.cast(certificate.getPublicKey(), useJavaClass("java.security.Key")).getAlgorithm(),
        sha256: () => javaBytesSha256(certificate.getEncoded()),
      }),
    };
  }
}
