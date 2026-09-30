import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { ReferenceTypeDecoder } from "../../builtin/ReferenceTypeDecoder";
import { SignatureDecoder } from "./SignatureDecoder";

const Signature = () => Java.use("java.security.Signature");

describe("SignatureDecoder", () => {
  it("decodes an uninitialized signature without choosing a provider", () => {
    const signature = Signature().getInstance("SHA256withECDSA");
    const decoder = new SignatureDecoder({ type: "java.security.Signature", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(signature).value).toEqual({ algorithm: "SHA256withECDSA", state: "UNINITIALIZED", provider: null });
    expect(Java.cast(signature, Signature()).provider.value).toBeNull();
  });

  it("decodes the state and provider of a signature initialized for signing", () => {
    const generator = Java.use("java.security.KeyPairGenerator").getInstance("EC");
    generator.initialize(256);
    const signature = Signature().getInstance("SHA256withECDSA");
    signature.initSign(generator.generateKeyPair().getPrivate());
    // the runtime class is a subclass such as Signature$Delegate
    const decoder = new ReferenceTypeDecoder({ type: "java.security.Signature", settings: DEFAULT_DECODER_SETTINGS });

    const fields = (decoder.decode(signature).value as { value: Record<string, unknown> }).value;

    expect(fields.state).toBe("SIGN");
    expect(typeof fields.provider).toBe("string");
  });
});
