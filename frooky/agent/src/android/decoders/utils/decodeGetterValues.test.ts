import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { decodeGetterValues } from "./decodeGetterValues";

describe("javaMethods", () => {
  describe("decodePublicMethodValues()", () => {
    const URI = Java.use("java.net.URI");

    it("should invoke and decode every matching getter with the stripped property name", () => {
      const uri = URI.create("https://mas.owasp.org/path?query#fragment");

      const values = decodeGetterValues(uri, ["get", "is"], DEFAULT_DECODER_SETTINGS);

      expect(values.find((v) => v.name === "scheme")).toEqual({ type: "java.lang.String", name: "scheme", value: "https" });
      expect(values.find((v) => v.name === "host")).toEqual({ type: "java.lang.String", name: "host", value: "mas.owasp.org" });
      expect(values.find((v) => v.name === "absolute")).toEqual({ type: "boolean", name: "absolute", value: true });
    });

    it("should decode a getter with no value for this instance as null, without throwing", () => {
      // an opaque URI (e.g. mailto:...) has no hierarchical component, so getHost() returns null
      const opaqueUri = URI.create("mailto:test@example.com");

      const values = decodeGetterValues(opaqueUri, ["get", "is"], DEFAULT_DECODER_SETTINGS);

      expect(values.find((v) => v.name === "opaque")).toEqual({ type: "boolean", name: "opaque", value: true });
      expect(values.find((v) => v.name === "host")).toEqual({ type: "java.lang.String", name: "host", value: null });
    });

    it("should skip methods that take arguments, even when their name matches a prefix", () => {
      // java.lang.Class has both a zero-argument getName() and a getMethod(String, Class<?>...)
      // that takes arguments - only the former is a getter and should be reflected/invoked
      const classInstance = URI.class;

      const values = decodeGetterValues(classInstance, ["get"], DEFAULT_DECODER_SETTINGS);

      expect(values.find((v) => v.name === "name")).toEqual({ type: "java.lang.String", name: "name", value: "java.net.URI" });
      expect(values.find((v) => v.name === "method")).toBeUndefined();
    });

    it("should decode a getter that throws as null, without aborting the rest of the decode", () => {
      const KeyProperties = Java.use("android.security.keystore.KeyProperties");
      const Builder = Java.use("android.security.keystore.KeyGenParameterSpec$Builder");
      const purposes = KeyProperties.PURPOSE_ENCRYPT.value | KeyProperties.PURPOSE_DECRYPT.value;
      // digests is left unset - getDigests() throws IllegalStateException, while
      // isDigestsSpecified() safely reports false, exercising the per-getter catch branch
      const spec = Builder.$new("test-alias", purposes).build();

      const values = decodeGetterValues(spec, ["get", "is"], DEFAULT_DECODER_SETTINGS);

      expect(values.find((v) => v.name === "digests")).toEqual({ type: "null", name: "digests", value: null });
      expect(values.find((v) => v.name === "digestsSpecified")).toEqual({ type: "boolean", name: "digestsSpecified", value: false });
    });

    it("should invoke getters when instance is wrapped as a narrower declared type than its runtime class", () => {
      // Regression test: instance.$className correctly reports the runtime class even when the
      // wrapper's own JS dispatcher table was built against a narrower type (here, the zero-method
      // marker interface KeyGenParameterSpec implements). Without decodePublicMethodValues casting
      // instance back to its own $className before invoking, every lookup below would silently
      // resolve to undefined and no properties would be decoded.
      const KeyProperties = Java.use("android.security.keystore.KeyProperties");
      const Builder = Java.use("android.security.keystore.KeyGenParameterSpec$Builder");
      const purposes = KeyProperties.PURPOSE_ENCRYPT.value | KeyProperties.PURPOSE_DECRYPT.value;
      const spec = Builder.$new("test-alias", purposes).setKeySize(256).build();
      const asInterface = Java.cast(spec, Java.use("java.security.spec.AlgorithmParameterSpec"));

      const values = decodeGetterValues(asInterface, ["get", "is"], DEFAULT_DECODER_SETTINGS);

      expect(values.find((v) => v.name === "keySize")).toEqual({ type: "int", name: "keySize", value: 256 });
      expect(values.find((v) => v.name === "keystoreAlias")).toEqual({ type: "java.lang.String", name: "keystoreAlias", value: "test-alias" });
    });
  });
});

export {};
