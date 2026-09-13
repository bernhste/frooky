import Java from "frida-java-bridge";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../../../shared/defaultValues";
import { KeyGenParameterSpecDecoder } from "./KeyGenParameterSpecDecoder";

describe("KeyGenParameterSpecDecoder", () => {
  const KeyProperties = Java.use("android.security.keystore.KeyProperties");
  const Builder = Java.use("android.security.keystore.KeyGenParameterSpec$Builder");
  const decoder = new KeyGenParameterSpecDecoder({
    type: "android.security.keystore.KeyGenParameterSpec",
    settings: DEFAULT_DECODER_SETTINGS,
  });

  function findProperty(properties: DecodedValue[], name: string): DecodedValue | undefined {
    return properties.find((p) => p.name === name);
  }

  it("should decode simple getters with the get/is prefix stripped from the name", () => {
    const purposes = KeyProperties.PURPOSE_ENCRYPT.value | KeyProperties.PURPOSE_DECRYPT.value;
    const spec = Builder.$new("test-alias", purposes).setKeySize(256).build();

    const result = decoder.decode(spec);

    expect(result.type).toBe("android.security.keystore.KeyGenParameterSpec");
    const properties = result.value as DecodedValue[];
    expect(findProperty(properties, "keystoreAlias")).toEqual({ type: "java.lang.String", name: "keystoreAlias", value: "test-alias" });
    expect(findProperty(properties, "keySize")).toEqual({ type: "int", name: "keySize", value: 256 });
    expect(findProperty(properties, "purposes")).toEqual({ type: "int", name: "purposes", value: purposes });
  });

  it("should decode array-typed getters", () => {
    const purposes = KeyProperties.PURPOSE_ENCRYPT.value | KeyProperties.PURPOSE_DECRYPT.value;
    const spec = Builder.$new("test-alias", purposes)
      .setBlockModes(Java.array("java.lang.String", ["GCM"]))
      .setEncryptionPaddings(Java.array("java.lang.String", ["NoPadding"]))
      .build();

    const result = decoder.decode(spec);

    const properties = result.value as DecodedValue[];
    expect(findProperty(properties, "blockModes")).toEqual({ type: "[Ljava.lang.String;", name: "blockModes", value: ["GCM"] });
    expect(findProperty(properties, "encryptionPaddings")).toEqual({
      type: "[Ljava.lang.String;",
      name: "encryptionPaddings",
      value: ["NoPadding"],
    });
  });

  it("should decode a getter that throws when unset as null, without aborting the whole decode", () => {
    // getDigests() throws IllegalStateException when digests haven't been configured on the
    // builder, while isDigestsSpecified() safely reports false - this exercises the per-getter
    // exception handling in decodePublicMethodValues rather than curating around it
    const purposes = KeyProperties.PURPOSE_ENCRYPT.value | KeyProperties.PURPOSE_DECRYPT.value;
    const spec = Builder.$new("test-alias", purposes).build();

    const result = decoder.decode(spec);

    const properties = result.value as DecodedValue[];
    expect(findProperty(properties, "digests")).toEqual({ type: "null", name: "digests", value: null });
    expect(findProperty(properties, "digestsSpecified")).toEqual({ type: "boolean", name: "digestsSpecified", value: false });
  });
});

export {};
