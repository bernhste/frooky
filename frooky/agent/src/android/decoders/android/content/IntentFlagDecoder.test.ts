import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { IntentFlagDecoder } from "./IntentFlagDecoder";

describe("IntentFlagDecoder", () => {
  describe("decode()", () => {
    const Intent = Java.use("android.content.Intent");
    const decoder = new IntentFlagDecoder({ type: "android.content.IntentFlagDecoder", settings: DEFAULT_DECODER_SETTINGS });

    it("should decode to an empty array when no flags are set", () => {
      const result = decoder.decode(0 as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "android.content.IntentFlag", value: [] });
    });

    it("should decode a single FLAG_* flag by its constant name", () => {
      const flagActivityNewTask: number = Intent.FLAG_ACTIVITY_NEW_TASK.value;

      const result = decoder.decode(flagActivityNewTask as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "android.content.IntentFlag", value: ["FLAG_ACTIVITY_NEW_TASK"] });
    });

    it("should decode a combination of flags to all matching constant names", () => {
      const flagActivityNewTask: number = Intent.FLAG_ACTIVITY_NEW_TASK.value;
      const flagActivitySingleTop: number = Intent.FLAG_ACTIVITY_SINGLE_TOP.value;

      const result = decoder.decode((flagActivityNewTask | flagActivitySingleTop) as unknown as Java.Wrapper);

      expect(result.type).toBe("android.content.IntentFlag");
      expect(result.value).toContain("FLAG_ACTIVITY_NEW_TASK");
      expect(result.value).toContain("FLAG_ACTIVITY_SINGLE_TOP");
    });
  });
});
