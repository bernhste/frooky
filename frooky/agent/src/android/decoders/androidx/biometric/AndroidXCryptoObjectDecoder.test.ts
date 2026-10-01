import Java from "frida-java-bridge";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { registerTestClass } from "../../utils/registerTestClass";
import { AndroidXCryptoObjectDecoder } from "./AndroidXCryptoObjectDecoder";

let fakeCryptoObjectClass: Java.Wrapper | undefined;
// AndroidX is part of the app, not of the dialer the tests run in. Like the app's class, the fake is loaded by a
// class loader that Java.use() doesn't search.
function fakeCryptoObject(cipher: Java.Wrapper): Java.Wrapper {
  fakeCryptoObjectClass ??= registerTestClass({
    name: "frooky.test.FakeCryptoObject",
    fields: { cipher: "javax.crypto.Cipher" },
    methods: {
      getCipher: {
        returnType: "javax.crypto.Cipher",
        argumentTypes: [],
        implementation: function (this: Java.Wrapper) {
          return this.cipher.value;
        },
      },
      getSignature: { returnType: "java.security.Signature", argumentTypes: [], implementation: () => null },
      getMac: { returnType: "javax.crypto.Mac", argumentTypes: [], implementation: () => null },
    },
  });
  const cryptoObject = fakeCryptoObjectClass.$new();
  cryptoObject.cipher.value = cipher;
  return cryptoObject;
}

describe("AndroidXCryptoObjectDecoder", () => {
  it("decodes the wrapped cipher of a class that Java.use() can't find", () => {
    const cipher = Java.use("javax.crypto.Cipher").getInstance("AES/GCM/NoPadding");
    const decoder = new AndroidXCryptoObjectDecoder({ type: "androidx.biometric.BiometricPrompt$CryptoObject", settings: DEFAULT_DECODER_SETTINGS });

    const properties = decoder.decode(fakeCryptoObject(cipher)).value as DecodedValue[];

    const decodedCipher = properties.find((property) => property.name === "cipher")?.value as DecodedValue;
    expect((decodedCipher.value as Record<string, unknown>).algorithm).toBe("AES/GCM/NoPadding");
    expect(properties.find((property) => property.name === "signature")).toEqual({ type: "java.security.Signature", name: "signature", value: null });
    expect(properties.find((property) => property.name === "mac")).toEqual({ type: "javax.crypto.Mac", name: "mac", value: null });
  });
});
