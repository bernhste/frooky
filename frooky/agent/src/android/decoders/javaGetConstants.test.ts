import Java from "frida-java-bridge";
import { loadJavaIntConstants } from "./javaGetConstants";

describe("javaConstants", () => {
  describe("loadJavaIntConstants()", () => {
    const MotionEvent = Java.use("android.view.MotionEvent");

    it("should reflect int constants matching the given prefix by name and value", () => {
      const actionDown: number = MotionEvent.ACTION_DOWN.value;
      const actionUp: number = MotionEvent.ACTION_UP.value;

      const constants = loadJavaIntConstants("android.view.MotionEvent", "ACTION_");

      expect(constants).toContain({ name: "ACTION_DOWN", value: actionDown });
      expect(constants).toContain({ name: "ACTION_UP", value: actionUp });
    });

    it("should only include constants whose name starts with the given prefix", () => {
      const constants = loadJavaIntConstants("android.view.MotionEvent", "ACTION_");

      expect(constants.length).toBeGreaterThan(0);
      expect(constants.every(({ name }) => name.startsWith("ACTION_"))).toBe(true);
    });

    it("should reflect a different set of constants for a different prefix on the same class", () => {
      const axisX: number = MotionEvent.AXIS_X.value;

      const constants = loadJavaIntConstants("android.view.MotionEvent", "AXIS_");

      expect(constants.length).toBeGreaterThan(0);
      expect(constants.every(({ name }) => name.startsWith("AXIS_"))).toBe(true);
      expect(constants).toContain({ name: "AXIS_X", value: axisX });
    });

    it("should cache the result for the same class/prefix pair instead of re-reflecting", () => {
      const first = loadJavaIntConstants("android.view.MotionEvent", "ACTION_");
      const second = loadJavaIntConstants("android.view.MotionEvent", "ACTION_");

      expect(second).toBe(first);
    });
  });
});
