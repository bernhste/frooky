import Java from "frida-java-bridge";
import { decodeConstantValues } from "./decodeConstants";

describe("javaConstants", () => {
  describe("decodePublicMethodValues()", () => {
    const MotionEvent = Java.use("android.view.MotionEvent");

    it("should reflect int constants matching the given prefix by name and value", () => {
      const actionDown: number = MotionEvent.ACTION_DOWN.value;
      const actionUp: number = MotionEvent.ACTION_UP.value;

      const constants = decodeConstantValues("android.view.MotionEvent", "ACTION_");

      expect(constants).toContainEqual({ type: "int", name: "ACTION_DOWN", value: actionDown });
      expect(constants).toContainEqual({ type: "int", name: "ACTION_UP", value: actionUp });
    });

    it("should only include constants whose name starts with the given prefix", () => {
      const constants = decodeConstantValues("android.view.MotionEvent", "ACTION_");

      expect(constants.length).toBeGreaterThan(0);
      expect(constants.every(({ name }) => name?.startsWith("ACTION_"))).toBe(true);
    });

    it("should reflect a different set of constants for a different prefix on the same class", () => {
      const axisX: number = MotionEvent.AXIS_X.value;

      const constants = decodeConstantValues("android.view.MotionEvent", "AXIS_");

      expect(constants.length).toBeGreaterThan(0);
      expect(constants.every(({ name }) => name?.startsWith("AXIS_"))).toBe(true);
      expect(constants).toContainEqual({ type: "int", name: "AXIS_X", value: axisX });
    });

    it("should cache the result for the same class/prefix pair instead of re-reflecting", () => {
      const first = decodeConstantValues("android.view.MotionEvent", "ACTION_");
      const second = decodeConstantValues("android.view.MotionEvent", "ACTION_");

      expect(second).toBe(first);
    });

    it("should skip non-static fields when reflecting every constant on a class with an empty prefix", () => {
      // javax.crypto.Cipher has both static final constants and private instance fields; reading an
      // instance field the same way as a static one (passing `null` as the target) throws, so this
      // would fail if non-static fields weren't filtered out.
      const Cipher = Java.use("javax.crypto.Cipher");
      const encryptMode: number = Cipher.ENCRYPT_MODE.value;

      const constants = decodeConstantValues("javax.crypto.Cipher", "");

      expect(constants).toContainEqual({ type: "int", name: "ENCRYPT_MODE", value: encryptMode });
    });
  });
});
