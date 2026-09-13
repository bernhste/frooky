import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { IntentUriFlagDecoder } from "./IntentUriFlagsDecoder";

describe("IntentUriFlagDecoder", () => {
  describe("decode()", () => {
    const Intent = Java.use("android.content.Intent");
    const decoder = new IntentUriFlagDecoder({ type: "android.content.IntentUriFlagDecoder", settings: DEFAULT_DECODER_SETTINGS });

    it("should decode to an empty array when no flags are set", () => {
      const result = decoder.decode(0 as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "android.content.IntentUriFlag", value: [] });
    });

    it("should decode a single URI_* flag by its constant name", () => {
      const uriIntentScheme: number = Intent.URI_INTENT_SCHEME.value;

      const result = decoder.decode(uriIntentScheme as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "android.content.IntentUriFlag", value: ["URI_INTENT_SCHEME"] });
    });

    it("should ignore bits that don't correspond to a known URI_* flag", () => {
      const uriIntentScheme: number = Intent.URI_INTENT_SCHEME.value;
      // an arbitrary high bit with no corresponding Intent.URI_* constant
      const bitmask = uriIntentScheme | 0x40000000;

      const result = decoder.decode(bitmask as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "android.content.IntentUriFlag", value: ["URI_INTENT_SCHEME"] });
    });
  });
});
