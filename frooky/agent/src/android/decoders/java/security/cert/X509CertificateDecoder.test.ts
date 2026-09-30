import { DEFAULT_DECODER_SETTINGS } from "../../../../../shared/defaultValues";
import { ReferenceTypeDecoder } from "../../../builtin/ReferenceTypeDecoder";
import { TEST_CERTIFICATE_FIELDS, testCertificate } from "./testCertificate";
import { X509CertificateDecoder } from "./X509CertificateDecoder";

describe("X509CertificateDecoder", () => {
  it("decodes the identifying fields and the SHA-256 fingerprint", () => {
    const decoder = new X509CertificateDecoder({ type: "java.security.cert.X509Certificate", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(testCertificate())).toEqual({ type: "java.security.cert.X509Certificate", value: TEST_CERTIFICATE_FIELDS });
  });

  it("limits the subject alternative names to maxItems", () => {
    const decoder = new X509CertificateDecoder({
      type: "java.security.cert.X509Certificate",
      settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 1 },
    });

    const fields = decoder.decode(testCertificate()).value as Record<string, unknown>;

    expect(fields.subjectAlternativeNames).toEqual(["frooky.test", "[truncated at 1]"]);
  });

  it("is chosen for the runtime subclass of X509Certificate", () => {
    const decoder = new ReferenceTypeDecoder({ type: "java.security.cert.Certificate", settings: DEFAULT_DECODER_SETTINGS });

    const result = decoder.decode(testCertificate());

    expect((result.value as { value: unknown }).value).toEqual(TEST_CERTIFICATE_FIELDS);
  });

  it("decodes null", () => {
    const decoder = new X509CertificateDecoder({ type: "java.security.cert.X509Certificate", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(null as never)).toEqual({ type: "java.security.cert.X509Certificate", value: null });
  });
});
