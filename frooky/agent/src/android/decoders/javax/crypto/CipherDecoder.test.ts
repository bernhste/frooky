import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { CipherDecoder } from "./CipherDecoder";

const Cipher = () => Java.use("javax.crypto.Cipher");

function initializedCipher(): Java.Wrapper {
  const key = Java.use("javax.crypto.spec.SecretKeySpec").$new(Java.array("byte", new Array(16).fill(1)), "AES");
  const spec = Java.use("javax.crypto.spec.GCMParameterSpec").$new(128, Java.array("byte", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
  const cipher = Cipher().getInstance("AES/GCM/NoPadding");
  cipher.init(Cipher().ENCRYPT_MODE.value, key, spec);
  return cipher;
}

describe("CipherDecoder", () => {
  it("decodes an uninitialized cipher without choosing a provider", () => {
    const cipher = Cipher().getInstance("AES/GCM/NoPadding");
    const decoder = new CipherDecoder({ type: "javax.crypto.Cipher", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(cipher)).toEqual({
      type: "javax.crypto.Cipher",
      value: { algorithm: "AES/GCM/NoPadding", initialized: false, opmode: null, provider: null, iv: null, blockSize: null },
    });
    // a chosen provider would stick and could reject a later key, e.g. from the Android Keystore
    expect(Java.cast(cipher, Cipher()).provider.value).toBeNull();
  });

  it("decodes the mode, provider, IV and block size of an initialized cipher", () => {
    const decoder = new CipherDecoder({ type: "javax.crypto.Cipher", settings: DEFAULT_DECODER_SETTINGS });

    const fields = decoder.decode(initializedCipher()).value as Record<string, unknown>;

    expect(fields.initialized).toBe(true);
    expect(fields.opmode).toBe("ENCRYPT_MODE");
    expect(typeof fields.provider).toBe("string");
    expect(fields.iv).toBe("0x000102030405060708090a0b");
    expect(fields.blockSize).toBe(16);
  });
});
