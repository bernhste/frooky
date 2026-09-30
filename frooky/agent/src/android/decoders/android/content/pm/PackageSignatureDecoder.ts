import Java from "frida-java-bridge";
import { Decoder } from "../../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { logger } from "../../../../../shared/logger";
import { decodeX509Certificate } from "../../../java/security/cert/X509CertificateDecoder";
import { javaBytesSha256, useJavaClass } from "../../../utils/javaValues";

// An app signature is the DER encoding of the signing certificate, so it is decoded as that certificate. Its
// `sha256` is the certificate fingerprint that e.g. `apksigner verify --print-certs` shows.
export class PackageSignatureDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "PackageSignatureDecoder";
  readonly description =
    "Decodes an `android.content.pm.Signature` (an app signing certificate) like an X.509 certificate, with its SHA-256 fingerprint.";

  decode(value: Java.Wrapper): DecodedValue {
    if (value == null) return { type: this.type, name: this.name, value: null };
    const bytes = Java.cast(value, useJavaClass("android.content.pm.Signature")).toByteArray();
    let decoded: Record<string, unknown>;
    try {
      const factory = useJavaClass("java.security.cert.CertificateFactory").getInstance("X.509");
      const certificate = factory.generateCertificate(useJavaClass("java.io.ByteArrayInputStream").$new(bytes));
      decoded = decodeX509Certificate(certificate, this.settings);
    } catch (e) {
      logger.debug(`Signature is no X.509 certificate: ${e}`);
      decoded = { sha256: javaBytesSha256(bytes) };
    }
    return { type: this.type, name: this.name, value: decoded };
  }
}
