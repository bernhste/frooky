import Java from "frida-java-bridge";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../../../shared/defaultValues";
import { ReferenceTypeDecoder } from "../../../builtin/ReferenceTypeDecoder";
import { registerTestClass } from "../../../utils/registerTestClass";
import { CertificateDecoder } from "./CertificateDecoder";
import { TEST_CERTIFICATE_SHA256, testCertificate } from "./testCertificate";

let fakeCertificateClass: Java.Wrapper | undefined;
// Android has no certificate type other than X.509, so the test declares one
function fakeCertificate(): Java.Wrapper {
  fakeCertificateClass ??= registerTestClass({
    name: "frooky.test.FakeCertificate",
    superClass: Java.use("java.security.cert.Certificate"),
    methods: {
      $init: [
        {
          returnType: "void",
          argumentTypes: [],
          implementation: function (this: Java.Wrapper) {
            this.$super.$init("PGP");
          },
        },
      ],
      getEncoded: { returnType: "[B", argumentTypes: [], implementation: () => Java.array("byte", [0xab, 0xcd]) },
      verify: [
        { returnType: "void", argumentTypes: ["java.security.PublicKey"], implementation: () => {} },
        { returnType: "void", argumentTypes: ["java.security.PublicKey", "java.lang.String"], implementation: () => {} },
      ],
      toString: { returnType: "java.lang.String", argumentTypes: [], implementation: () => "fake certificate" },
      getPublicKey: { returnType: "java.security.PublicKey", argumentTypes: [], implementation: () => null },
    },
  });
  return fakeCertificateClass.$new();
}

describe("CertificateDecoder", () => {
  it("decodes the type, public key algorithm and fingerprint of any certificate", () => {
    const decoder = new CertificateDecoder({ type: "java.security.cert.Certificate", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(testCertificate()).value).toEqual({ type: "X.509", publicKeyAlgorithm: "EC", sha256: TEST_CERTIFICATE_SHA256 });
  });

  it("is chosen for a certificate that is not X.509", () => {
    const decoder = new ReferenceTypeDecoder({ type: "java.security.cert.Certificate", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(fakeCertificate()).value).toEqual({
      type: "frooky.test.FakeCertificate",
      value: {
        type: "PGP",
        // getPublicKey() returns null
        publicKeyAlgorithm: null,
        // sha256 of the bytes ab cd
        sha256: "123d4c7ef2d1600a1b3a0f6addc60a10f05a3495c9409f2ecbf4cc095d000a6b",
      },
    });
  });

  it("is not chosen for an X.509 certificate, which has its own decoder", () => {
    const decoder = new ReferenceTypeDecoder({ type: "java.security.cert.Certificate", settings: DEFAULT_DECODER_SETTINGS });

    const inner = decoder.decode(testCertificate()).value as DecodedValue;

    expect((inner.value as Record<string, unknown>).subject).toBe("O=frooky,CN=frooky.test");
  });
});
