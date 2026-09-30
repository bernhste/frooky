import Java from "frida-java-bridge";
import { Decoder } from "../../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { DecoderSettings } from "../../../../../shared/frookySettings";
import { decodeFields, javaBytesSha256, javaDateToIso, useJavaClass } from "../../../utils/javaValues";

// The fields of a certificate that identify it, e.g. to check what an app pins or trusts. `sha256` is the
// fingerprint of the DER encoding, as shown by `openssl x509 -fingerprint -sha256` (without colons).
export function decodeX509Certificate(value: Java.Wrapper, settings: DecoderSettings): Record<string, unknown> {
  const cert = Java.cast(value, useJavaClass("java.security.cert.X509Certificate"));
  return decodeFields("X509Certificate", {
    subject: () => cert.getSubjectX500Principal().getName(),
    issuer: () => cert.getIssuerX500Principal().getName(),
    serialNumber: () => "0x" + cert.getSerialNumber().toString(16),
    notBefore: () => javaDateToIso(cert.getNotBefore()),
    notAfter: () => javaDateToIso(cert.getNotAfter()),
    signatureAlgorithm: () => cert.getSigAlgName(),
    // the wrapper is typed as the interface PublicKey, which doesn't declare the getAlgorithm() of Key
    publicKeyAlgorithm: () => Java.cast(cert.getPublicKey(), useJavaClass("java.security.Key")).getAlgorithm(),
    subjectAlternativeNames: () => decodeSubjectAlternativeNames(cert, settings.maxItems),
    sha256: () => javaBytesSha256(cert.getEncoded()),
  });
}

// Each alternative name is a List of its type (2 = DNS, 7 = IP, ...) and its value, see
// X509Certificate.getSubjectAlternativeNames(). Only the values, e.g. ["example.org", "10.0.0.1"].
function decodeSubjectAlternativeNames(cert: Java.Wrapper, maxItems: number): string[] | null {
  const names = cert.getSubjectAlternativeNames();
  if (names == null) return null;
  const entries = names.toArray();
  const result: string[] = [];
  for (let i = 0; i < Math.min(entries.length, maxItems); i++) {
    const entry = Java.cast(entries[i], useJavaClass("java.util.List"));
    result.push(String(entry.get(1)));
  }
  if (entries.length > maxItems) result.push(`[truncated at ${maxItems}]`);
  return result;
}

export class X509CertificateDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "X509CertificateDecoder";
  readonly description =
    "Decodes a `java.security.cert.X509Certificate`: subject, issuer, serial number, validity, algorithms, subject alternative names and SHA-256 fingerprint.";

  decode(value: Java.Wrapper): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: value == null ? null : decodeX509Certificate(value, this.settings),
    };
  }
}
