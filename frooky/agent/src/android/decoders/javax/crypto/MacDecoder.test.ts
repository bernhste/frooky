import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { MacDecoder } from "./MacDecoder";

const Mac = () => Java.use("javax.crypto.Mac");

describe("MacDecoder", () => {
  it("decodes an uninitialized Mac without choosing a provider", () => {
    const mac = Mac().getInstance("HmacSHA256");
    const decoder = new MacDecoder({ type: "javax.crypto.Mac", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(mac)).toEqual({
      type: "javax.crypto.Mac",
      value: { algorithm: "HmacSHA256", initialized: false, provider: null, macLength: null },
    });
    expect(Java.cast(mac, Mac()).provider.value).toBeNull();
  });

  it("decodes the provider and MAC length of an initialized Mac", () => {
    const mac = Mac().getInstance("HmacSHA256");
    mac.init(Java.use("javax.crypto.spec.SecretKeySpec").$new(Java.array("byte", [1, 2, 3]), "HmacSHA256"));
    const decoder = new MacDecoder({ type: "javax.crypto.Mac", settings: DEFAULT_DECODER_SETTINGS });

    const fields = decoder.decode(mac).value as Record<string, unknown>;

    expect(fields.initialized).toBe(true);
    expect(typeof fields.provider).toBe("string");
    expect(fields.macLength).toBe(32);
  });
});
