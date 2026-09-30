import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { ReferenceTypeDecoder } from "../../builtin/ReferenceTypeDecoder";

describe("MessageDigestDecoder", () => {
  it("decodes the algorithm, provider and digest length", () => {
    const digest = Java.use("java.security.MessageDigest").getInstance("SHA-256");
    // the runtime class is a subclass such as MessageDigest$Delegate
    const decoder = new ReferenceTypeDecoder({ type: "java.security.MessageDigest", settings: DEFAULT_DECODER_SETTINGS });

    const fields = (decoder.decode(digest).value as { value: Record<string, unknown> }).value;

    expect(fields.algorithm).toBe("SHA-256");
    expect(typeof fields.provider).toBe("string");
    expect(fields.digestLength).toBe(32);
  });
});
