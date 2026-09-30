import Java from "frida-java-bridge";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../../../shared/defaultValues";
import { ReferenceTypeDecoder } from "../../../builtin/ReferenceTypeDecoder";
import { SpecDecoder } from "./SpecDecoder";

function properties(result: DecodedValue): Record<string, unknown> {
  return Object.fromEntries((result.value as DecodedValue[]).map((property) => [property.name, property.value]));
}

describe("SpecDecoder", () => {
  it("decodes a GCMParameterSpec with its IV as hex", () => {
    const iv = Java.array("byte", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const spec = Java.use("javax.crypto.spec.GCMParameterSpec").$new(128, iv);
    const decoder = new SpecDecoder({ type: "javax.crypto.spec.GCMParameterSpec", settings: DEFAULT_DECODER_SETTINGS });

    expect(properties(decoder.decode(spec))).toEqual({ TLen: 128, IV: "0x000102030405060708090a0b" });
  });

  it("decodes a PBEKeySpec with its password as text", () => {
    const password = Java.array("char", ["s", "3", "c", "r", "3", "t"]);
    const salt = Java.array("byte", [0xa, 0xb]);
    const spec = Java.use("javax.crypto.spec.PBEKeySpec").$new(password, salt, 1000, 256);
    const decoder = new SpecDecoder({ type: "javax.crypto.spec.PBEKeySpec", settings: DEFAULT_DECODER_SETTINGS });

    expect(properties(decoder.decode(spec))).toEqual({ password: "s3cr3t", salt: "0x0a0b", iterationCount: 1000, keyLength: 256 });
  });

  it("includes the getters inherited from superclasses", () => {
    // getModulus() and getPrivateExponent() are declared by the superclass RSAPrivateKeySpec
    const BigInteger = Java.use("java.math.BigInteger");
    const n = (value: number) => BigInteger.$new(String(value));
    const spec = Java.use("java.security.spec.RSAPrivateCrtKeySpec").$new(n(3233), n(17), n(413), n(61), n(53), n(53), n(49), n(38));
    const decoder = new SpecDecoder({ type: "java.security.spec.RSAPrivateCrtKeySpec", settings: DEFAULT_DECODER_SETTINGS });

    const result = properties(decoder.decode(spec));

    expect(result.modulus).toEqual({ type: "java.math.BigInteger", name: "modulus", value: "3233" });
    expect(result.publicExponent).toEqual({ type: "java.math.BigInteger", name: "publicExponent", value: "17" });
  });

  it("is chosen for an IvParameterSpec declared as AlgorithmParameterSpec", () => {
    const spec = Java.use("javax.crypto.spec.IvParameterSpec").$new(Java.array("byte", [1, 2]));
    const decoder = new ReferenceTypeDecoder({ type: "java.security.spec.AlgorithmParameterSpec", settings: DEFAULT_DECODER_SETTINGS });

    expect(properties(decoder.decode(spec).value as DecodedValue)).toEqual({ IV: "0x0102" });
  });
});
