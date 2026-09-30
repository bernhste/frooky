import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../../../shared/defaultValues";
import { TEST_CERTIFICATE_FIELDS, testCertificateDer } from "../../../java/security/cert/testCertificate";
import { PackageSignatureDecoder } from "./PackageSignatureDecoder";

const Signature = () => Java.use("android.content.pm.Signature");

describe("PackageSignatureDecoder", () => {
  it("decodes a signature as its signing certificate", () => {
    const decoder = new PackageSignatureDecoder({ type: "android.content.pm.Signature", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(Signature().$new(testCertificateDer()))).toEqual({
      type: "android.content.pm.Signature",
      value: TEST_CERTIFICATE_FIELDS,
    });
  });

  it("decodes a signature that is no certificate as its SHA-256", () => {
    const decoder = new PackageSignatureDecoder({ type: "android.content.pm.Signature", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(Signature().$new("abcd")).value).toEqual({
      // sha256 of the bytes ab cd
      sha256: "123d4c7ef2d1600a1b3a0f6addc60a10f05a3495c9409f2ecbf4cc095d000a6b",
    });
  });
});
