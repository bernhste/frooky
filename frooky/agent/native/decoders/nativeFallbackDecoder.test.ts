import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { NativeFallbackDecoder } from "./nativeFallbackDecoder";

describe("NativeFallbackDecoder", () => {
  describe("decode()", () => {
    it("should decode a unknown decodable to its address as string", () => {
      const decoder = new NativeFallbackDecoder({ type: "customStruct", settings: DEFAULT_DECODER_SETTINGS });
      expect(decoder.decode(ptr(0x12345678))).toEqual({ type: "customStruct", value: "0x12345678" });
    });
  });
});
