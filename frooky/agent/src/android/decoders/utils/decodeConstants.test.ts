import Java from "frida-java-bridge";
import { logger } from "../../../shared/logger";
import { classConstants, decodeConstantValues, parseConstantsClass } from "./decodeConstants";

describe("javaConstants", () => {
  describe("decodePublicMethodValues()", () => {
    const MotionEvent = Java.use("android.view.MotionEvent");

    it("should reflect int constants matching the given pattern by name and value", () => {
      const actionDown: number = MotionEvent.ACTION_DOWN.value;
      const actionUp: number = MotionEvent.ACTION_UP.value;

      const constants = decodeConstantValues("android.view.MotionEvent", "ACTION_*");

      expect(constants).toContainEqual({ type: "int", name: "ACTION_DOWN", value: actionDown });
      expect(constants).toContainEqual({ type: "int", name: "ACTION_UP", value: actionUp });
    });

    it("should only include constants whose name matches the given pattern", () => {
      const constants = decodeConstantValues("android.view.MotionEvent", "ACTION_*");

      expect(constants.length).toBeGreaterThan(0);
      expect(constants.every(({ name }) => name?.startsWith("ACTION_"))).toBe(true);
    });

    it("should reflect a different set of constants for a different pattern on the same class", () => {
      const axisX: number = MotionEvent.AXIS_X.value;

      const constants = decodeConstantValues("android.view.MotionEvent", "AXIS_*");

      expect(constants.length).toBeGreaterThan(0);
      expect(constants.every(({ name }) => name?.startsWith("AXIS_"))).toBe(true);
      expect(constants).toContainEqual({ type: "int", name: "AXIS_X", value: axisX });
    });

    it("should cache the result for the same class/pattern pair instead of re-reflecting", () => {
      const first = decodeConstantValues("android.view.MotionEvent", "ACTION_*");
      const second = decodeConstantValues("android.view.MotionEvent", "ACTION_*");

      expect(second).toBe(first);
    });

    it("should skip non-static fields when reflecting every constant on a class", () => {
      // javax.crypto.Cipher has both static final constants and private instance fields; reading an
      // instance field the same way as a static one (passing `null` as the target) throws, so this
      // would fail if non-static fields weren't filtered out.
      const Cipher = Java.use("javax.crypto.Cipher");
      const encryptMode: number = Cipher.ENCRYPT_MODE.value;

      const constants = decodeConstantValues("javax.crypto.Cipher");

      expect(constants).toContainEqual({ type: "int", name: "ENCRYPT_MODE", value: encryptMode });
    });

    it("should match a pattern with `*` anywhere, e.g. at the start", () => {
      const constants = decodeConstantValues("javax.crypto.Cipher", "*_MODE");

      expect(constants.map(({ name }) => name).sort()).toEqual(["DECRYPT_MODE", "ENCRYPT_MODE", "UNWRAP_MODE", "WRAP_MODE"]);
    });

    it("should look a class up through the class loader of `visibleTo` if the default class loader doesn't have it", () => {
      // registered through the ClassFactory of another class loader, so Java.use() doesn't know the class, like a
      // class of a dex the app loads itself
      const className = "frooky.test.ConstantsHolder";
      const factory = Java.ClassFactory.get(Java.use("java.lang.ClassLoader").getSystemClassLoader());
      const packageName: string = Java.use("android.app.ActivityThread").currentPackageName();
      factory.cacheDir = `/data/data/${packageName}/cache`;
      factory.registerClass({ name: className, fields: { value: "int" } });

      expect(() => Java.use(className)).toThrow();
      expect(() => decodeConstantValues(className)).toThrow();
      expect(decodeConstantValues(className, "*", className)).toEqual([]);
    });
  });

  describe("parseConstantsClass()", () => {
    it("should split a class and a pattern for its fields, all fields without a pattern", () => {
      expect(parseConstantsClass("javax.crypto.Cipher#*_MODE")).toEqual({ className: "javax.crypto.Cipher", pattern: "*_MODE" });
      expect(parseConstantsClass("javax.crypto.Cipher")).toEqual({ className: "javax.crypto.Cipher", pattern: "*" });
      expect(parseConstantsClass("com.example.Outer$Inner#FLAG_*")).toEqual({ className: "com.example.Outer$Inner", pattern: "FLAG_*" });
    });

    it("should throw for no class name or an empty pattern", () => {
      for (const reference of ["", "Cipher#", "#FLAG_*", "javax..Cipher", "javax.crypto.Cipher#FLAG.*", "javax.crypto.Cipher#A#B"]) {
        expect(() => parseConstantsClass(reference)).toThrow(`'${reference}' is no class with constants.`);
      }
    });
  });

  describe("classConstants()", () => {
    let warnSpy: Mock;
    beforeEach(() => {
      warnSpy = spyOn(logger, "warn");
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("should return the constants of the type of the value", () => {
      const constants = classConstants("android.content.Intent#FLAG_ACTIVITY_*", "int");

      expect(constants.length).toBeGreaterThan(0);
      expect(constants.every(({ type }) => type === "int")).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("should warn and return none if no constant has the type of the value", () => {
      // the ACTION_* constants of Intent are strings
      expect(classConstants("android.content.Intent#ACTION_*", "int")).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        "config.constants 'android.content.Intent#ACTION_*': 'android.content.Intent' has no static final int field matching 'ACTION_*'.",
      );
    });

    it("should warn and return none for a class that isn't found", () => {
      expect(classConstants("com.example.Missing#FLAG_*", "int")).toEqual([]);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).toContain("config.constants 'com.example.Missing#FLAG_*': ");
      expect(message).toContain("The value is decoded as it is.");
    });
  });
});
