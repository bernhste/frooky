import Java from "frida-java-bridge";

// Self-signed EC certificate for tests, created with:
// openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -subj "/CN=frooky.test/O=frooky" \
//   -set_serial 0x1a2b3c -days 3650 -addext "subjectAltName=DNS:frooky.test,IP:10.0.0.1"
export const TEST_CERTIFICATE_DER_BASE64 =
  "MIIBsTCCAVagAwIBAgIDGis8MAoGCCqGSM49BAMCMCcxFDASBgNVBAMMC2Zyb29reS50ZXN0MQ8wDQYDVQQKDAZmcm9va3kwHhcNMjYwOTMwMjMyOTM5WhcNMzYwOTI3MjMyOTM5WjAnMRQwEgYDVQQDDAtmcm9va3kudGVzdDEPMA0GA1UECgwGZnJvb2t5MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEpFzAKoJhcZDvt7XMFPRxdudy+81ActtlhrX7S9f6mFO1wPC/W+TnvWPtSMhw1mzazvHy1mnmGgwBdn/sfSNnS6NxMG8wHQYDVR0OBBYEFAVwlB8QlyhT1K+Rrrl0hDYegPIhMB8GA1UdIwQYMBaAFAVwlB8QlyhT1K+Rrrl0hDYegPIhMA8GA1UdEwEB/wQFMAMBAf8wHAYDVR0RBBUwE4ILZnJvb2t5LnRlc3SHBAoAAAEwCgYIKoZIzj0EAwIDSQAwRgIhANl5Ep1XzrwVP0rMwFpOSZwzekEXJWUdRKW+ORg8qEdhAiEAuAYXf5t4q4VETLQ3dlkxlrH2+1ACm928M5Fi2C+o/Ww=";

// `openssl x509 -fingerprint -sha256` without colons
export const TEST_CERTIFICATE_SHA256 = "53d38f26714c02ee455115c7b4c610e8978e0b70865039bac08a1e007d4a14cd";

export const TEST_CERTIFICATE_FIELDS = {
  subject: "O=frooky,CN=frooky.test",
  issuer: "O=frooky,CN=frooky.test",
  serialNumber: "0x1a2b3c",
  notBefore: "2026-09-30T23:29:39.000Z",
  notAfter: "2036-09-27T23:29:39.000Z",
  signatureAlgorithm: "SHA256withECDSA",
  publicKeyAlgorithm: "EC",
  subjectAlternativeNames: ["frooky.test", "10.0.0.1"],
  sha256: TEST_CERTIFICATE_SHA256,
};

export function testCertificateDer(): Java.Wrapper {
  return Java.use("android.util.Base64").decode(TEST_CERTIFICATE_DER_BASE64, 0);
}

export function testCertificate(): Java.Wrapper {
  const factory = Java.use("java.security.cert.CertificateFactory").getInstance("X.509");
  return factory.generateCertificate(Java.use("java.io.ByteArrayInputStream").$new(testCertificateDer()));
}
