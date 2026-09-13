import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { decodePublicMethodValues, loadPublicMethodNames } from "./javaGetMethods";

describe("javaMethods", () => {
  const URI_CLASS = "java.net.URI";

  describe("loadPublicMethodNames()", () => {
    it("should reflect public zero-arg methods matching the given prefixes", () => {
      const descriptors = loadPublicMethodNames(URI_CLASS, ["get", "is"]);
      const names = descriptors.map((d) => d.methodName);

      expect(names).toContain("getScheme");
      expect(names).toContain("getHost");
      expect(names).toContain("isAbsolute");
    });

    it("should not include methods inherited from a superclass", () => {
      const descriptors = loadPublicMethodNames(URI_CLASS, ["get", "is"]);
      const names = descriptors.map((d) => d.methodName);

      expect(names).not.toContain("getClass");
    });

    it("should keep the raw method name by default", () => {
      const descriptors = loadPublicMethodNames(URI_CLASS, ["get"]);
      const scheme = descriptors.find((d) => d.methodName === "getScheme");

      expect(scheme?.propertyName).toBe("getScheme");
    });

    it("should strip the prefix and lowercase the next character when requested", () => {
      const descriptors = loadPublicMethodNames(URI_CLASS, ["get"], true);
      const scheme = descriptors.find((d) => d.methodName === "getScheme");
      const isAbsolute = loadPublicMethodNames(URI_CLASS, ["is"], true).find((d) => d.methodName === "isAbsolute");

      expect(scheme?.propertyName).toBe("scheme");
      expect(isAbsolute?.propertyName).toBe("absolute");
    });

    it("should cache the result for the same class/prefixes/stripPrefix combination", () => {
      const first = loadPublicMethodNames(URI_CLASS, ["get", "is"], true);
      const second = loadPublicMethodNames(URI_CLASS, ["get", "is"], true);

      expect(second).toBe(first);
    });
  });

  describe("decodePublicMethodValues()", () => {
    const URI = Java.use(URI_CLASS);

    it("should invoke and decode every matching getter with the stripped property name", () => {
      const uri = URI.create("https://mas.owasp.org/path?query#fragment");

      const values = decodePublicMethodValues(uri, URI_CLASS, ["get", "is"], DEFAULT_DECODER_SETTINGS, true);

      expect(values.find((v) => v.name === "scheme")).toEqual({ type: "java.lang.String", name: "scheme", value: "https" });
      expect(values.find((v) => v.name === "host")).toEqual({ type: "java.lang.String", name: "host", value: "mas.owasp.org" });
      expect(values.find((v) => v.name === "absolute")).toEqual({ type: "boolean", name: "absolute", value: true });
    });

    it("should keep the raw method name when stripPrefix is not requested", () => {
      const uri = URI.create("https://mas.owasp.org");

      const values = decodePublicMethodValues(uri, URI_CLASS, ["get"], DEFAULT_DECODER_SETTINGS);

      expect(values.find((v) => v.name === "getScheme")).toEqual({ type: "java.lang.String", name: "getScheme", value: "https" });
    });

    it("should decode a getter with no value for this instance as null, without throwing", () => {
      // an opaque URI (e.g. mailto:...) has no hierarchical component, so getHost() returns null
      const opaqueUri = URI.create("mailto:test@example.com");

      const values = decodePublicMethodValues(opaqueUri, URI_CLASS, ["get", "is"], DEFAULT_DECODER_SETTINGS, true);

      expect(values.find((v) => v.name === "opaque")).toEqual({ type: "boolean", name: "opaque", value: true });
      expect(values.find((v) => v.name === "host")).toEqual({ type: "java.lang.String", name: "host", value: null });
    });
  });
});

export {};
