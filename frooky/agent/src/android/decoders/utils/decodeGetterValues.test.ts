import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { decodeGetterValues } from "./decodeGetterValues";

describe("javaMethods", () => {
  describe("decodePublicMethodValues()", () => {
    const URI = Java.use("java.net.URI");

    it("should invoke and decode every matching getter with the stripped property name", () => {
      const uri = URI.create("https://mas.owasp.org/path?query#fragment");

      const values = decodeGetterValues(uri, DEFAULT_DECODER_SETTINGS, { prefixes: ["get", "is"] });

      expect(values.find((v) => v.name === "scheme")).toEqual({ type: "java.lang.String", name: "scheme", value: "https" });
      expect(values.find((v) => v.name === "host")).toEqual({ type: "java.lang.String", name: "host", value: "mas.owasp.org" });
      expect(values.find((v) => v.name === "absolute")).toEqual({ type: "boolean", name: "absolute", value: true });
    });

    it("should decode a getter with no value for this instance as null, without throwing", () => {
      // an opaque URI (e.g. mailto:...) has no hierarchical component, so getHost() returns null
      const opaqueUri = URI.create("mailto:test@example.com");

      const values = decodeGetterValues(opaqueUri, DEFAULT_DECODER_SETTINGS, { prefixes: ["get", "is"] });

      expect(values.find((v) => v.name === "opaque")).toEqual({ type: "boolean", name: "opaque", value: true });
      expect(values.find((v) => v.name === "host")).toEqual({ type: "java.lang.String", name: "host", value: null });
    });

    it("should skip methods that take arguments, even when their name matches a prefix", () => {
      // java.lang.Class has both a zero-argument getName() and a getMethod(String, Class<?>...)
      // that takes arguments - only the former is a getter and should be reflected/invoked
      const classInstance = URI.class;

      const values = decodeGetterValues(classInstance, DEFAULT_DECODER_SETTINGS);

      expect(values.find((v) => v.name === "name")).toEqual({ type: "java.lang.String", name: "name", value: "java.net.URI" });
      expect(values.find((v) => v.name === "method")).toBeUndefined();
    });

    it("should decode a getter that throws as null, without aborting the rest of the decode", () => {
      const KeyProperties = Java.use("android.security.keystore.KeyProperties");
      const Builder = Java.use("android.security.keystore.KeyGenParameterSpec$Builder");
      const purposes = KeyProperties.PURPOSE_ENCRYPT.value | KeyProperties.PURPOSE_DECRYPT.value;
      // getDigests() throws IllegalStateException when no digests are set
      const spec = Builder.$new("test-alias", purposes).build();

      const values = decodeGetterValues(spec, DEFAULT_DECODER_SETTINGS, { prefixes: ["get", "is"] });

      expect(values.find((v) => v.name === "digests")).toEqual({ type: "null", name: "digests", value: null });
      expect(values.find((v) => v.name === "digestsSpecified")).toEqual({ type: "boolean", name: "digestsSpecified", value: false });
    });

    it("should invoke getters when instance is wrapped as a narrower declared type than its runtime class", () => {
      // wrapped as the marker interface KeyGenParameterSpec implements, which has no methods
      const KeyProperties = Java.use("android.security.keystore.KeyProperties");
      const Builder = Java.use("android.security.keystore.KeyGenParameterSpec$Builder");
      const purposes = KeyProperties.PURPOSE_ENCRYPT.value | KeyProperties.PURPOSE_DECRYPT.value;
      const spec = Builder.$new("test-alias", purposes).setKeySize(256).build();
      const asInterface = Java.cast(spec, Java.use("java.security.spec.AlgorithmParameterSpec"));

      const values = decodeGetterValues(asInterface, DEFAULT_DECODER_SETTINGS, { prefixes: ["get", "is"] });

      expect(values.find((v) => v.name === "keySize")).toEqual({ type: "int", name: "keySize", value: 256 });
      expect(values.find((v) => v.name === "keystoreAlias")).toEqual({ type: "java.lang.String", name: "keystoreAlias", value: "test-alias" });
    });
  });

  it("keeps a property name that starts with two capitals, like java.beans.Introspector", () => {
    const spec = Java.use("javax.crypto.spec.IvParameterSpec").$new(Java.array("byte", [1, 2]));

    const values = decodeGetterValues(spec, DEFAULT_DECODER_SETTINGS);

    expect(values.map((v) => v.name)).toEqual(["IV"]);
  });

  it("decodes byte[] as hex and char[] as text with compactArrays", () => {
    const password = Java.array("char", ["p", "w"]);
    const spec = Java.use("javax.crypto.spec.PBEKeySpec").$new(password, Java.array("byte", [0xff]), 1, 8);

    const values = decodeGetterValues(spec, DEFAULT_DECODER_SETTINGS, { compactArrays: true });

    expect(values.find((v) => v.name === "password")).toEqual({ type: "[C", name: "password", value: "pw" });
    expect(values.find((v) => v.name === "salt")).toEqual({ type: "[B", name: "salt", value: "0xff" });
  });

  it("calls the getters of the given class and, with inherited, of its superclasses", () => {
    // LabeledIntent declares getSourcePackage(), its superclass Intent getAction()
    const Intent = Java.use("android.content.Intent");
    const labeledIntent = Java.use("android.content.pm.LabeledIntent").$new(Intent.$new("android.intent.action.VIEW"), "com.example", 0, 0);

    const own = decodeGetterValues(labeledIntent, DEFAULT_DECODER_SETTINGS).map((v) => v.name);
    const inherited = decodeGetterValues(labeledIntent, DEFAULT_DECODER_SETTINGS, { inherited: true }).map((v) => v.name);
    const ofIntent = decodeGetterValues(labeledIntent, DEFAULT_DECODER_SETTINGS, { className: "android.content.Intent" }).map((v) => v.name);

    expect(own).toContain("sourcePackage");
    expect(own).not.toContain("action");
    expect(inherited).toContain("sourcePackage");
    expect(inherited).toContain("action");
    expect(inherited).not.toContain("class");
    expect(ofIntent).toContain("action");
    expect(ofIntent).not.toContain("sourcePackage");
  });
});

export {};
