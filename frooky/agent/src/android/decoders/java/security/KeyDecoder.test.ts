import Java from "frida-java-bridge";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { ReferenceTypeDecoder } from "../../builtin/ReferenceTypeDecoder";
import { KeyDecoder } from "./KeyDecoder";

function aesKey(): Java.Wrapper {
  const bytes = Java.array("byte", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  return Java.use("javax.crypto.spec.SecretKeySpec").$new(bytes, "AES");
}

describe("KeyDecoder", () => {
  it("decodes a secret key with its key material as hex", () => {
    const decoder = new KeyDecoder({ type: "javax.crypto.spec.SecretKeySpec", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(aesKey())).toEqual({
      type: "javax.crypto.spec.SecretKeySpec",
      value: { algorithm: "AES", format: "RAW", encoded: "0x0102030405060708090a0b0c0d0e0f10" },
    });
  });

  it("limits the key material to maxItems bytes", () => {
    const decoder = new KeyDecoder({ type: "javax.crypto.spec.SecretKeySpec", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 4 } });

    expect((decoder.decode(aesKey()).value as Record<string, unknown>).encoded).toBe("0x01020304...");
  });

  it("decodes a public key in its X.509 encoding", () => {
    const generator = Java.use("java.security.KeyPairGenerator").getInstance("EC");
    generator.initialize(256);
    const publicKey = generator.generateKeyPair().getPublic();
    const decoder = new KeyDecoder({ type: "java.security.PublicKey", settings: DEFAULT_DECODER_SETTINGS });

    const fields = decoder.decode(publicKey).value as Record<string, string>;

    expect(fields.algorithm).toBe("EC");
    expect(fields.format).toBe("X.509");
    // a DER SEQUENCE
    expect(fields.encoded.startsWith("0x30")).toBe(true);
  });

  it("is chosen over KeySpec for SecretKeySpec, which implements both", () => {
    const decoder = new ReferenceTypeDecoder({ type: "java.security.Key", settings: DEFAULT_DECODER_SETTINGS });

    const inner = decoder.decode(aesKey()).value as DecodedValue;

    expect(inner.value).toEqual({ algorithm: "AES", format: "RAW", encoded: "0x0102030405060708090a0b0c0d0e0f10" });
  });

  it("decodes null", () => {
    const decoder = new KeyDecoder({ type: "java.security.Key", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(null as never)).toEqual({ type: "java.security.Key", value: null });
  });
});
