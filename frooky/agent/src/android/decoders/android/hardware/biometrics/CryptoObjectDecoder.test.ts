import Java from "frida-java-bridge";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../../../shared/defaultValues";
import { CryptoObjectDecoder } from "./CryptoObjectDecoder";

describe("CryptoObjectDecoder", () => {
  it("decodes the wrapped cipher with the Cipher decoder", () => {
    const cipher = Java.use("javax.crypto.Cipher").getInstance("AES/GCM/NoPadding");
    const cryptoObject = Java.use("android.hardware.biometrics.BiometricPrompt$CryptoObject").$new(cipher);
    const decoder = new CryptoObjectDecoder({ type: "android.hardware.biometrics.BiometricPrompt$CryptoObject", settings: DEFAULT_DECODER_SETTINGS });

    const properties = decoder.decode(cryptoObject).value as DecodedValue[];

    const decodedCipher = properties.find((property) => property.name === "cipher")?.value as DecodedValue;
    expect(decodedCipher.type).toBe("javax.crypto.Cipher");
    expect((decodedCipher.value as Record<string, unknown>).algorithm).toBe("AES/GCM/NoPadding");
    expect(properties.find((property) => property.name === "mac")).toEqual({ type: "javax.crypto.Mac", name: "mac", value: null });
  });
});
