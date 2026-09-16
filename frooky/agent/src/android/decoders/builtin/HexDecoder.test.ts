import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { toHex } from "../../../shared/utils";
import { HexDecoder } from "./HexDecoder";

describe("HexDecoder", () => {
  describe("decode()", () => {
    it("should decode a '[B' byte array as hex", () => {
      const bytes = Java.array("byte", [0x41, 0x42, 0x43]); // "ABC"
      const decoder = new HexDecoder({ type: "[B", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(bytes as unknown as Java.Wrapper);

      const expectedHex = toHex(new Uint8Array([0x41, 0x42, 0x43]));
      expect(result).toEqual({ type: "[B", value: expectedHex });
    });

    it("should include the decodable name in the result", () => {
      const bytes = Java.array("byte", [0x41, 0x42, 0x43]);
      const decoder = new HexDecoder({ type: "[B", name: "myParam", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(bytes as unknown as Java.Wrapper);

      const expectedHex = toHex(new Uint8Array([0x41, 0x42, 0x43]));
      expect(result).toEqual({ type: "[B", name: "myParam", value: expectedHex });
    });

    it("should truncate a '[B' byte array longer than decodeLimit and append an ellipsis", () => {
      const rawBytes = [0x41, 0x42, 0x43, 0x44, 0x45];
      const bytes = Java.array("byte", rawBytes);
      const decoder = new HexDecoder({ type: "[B", settings: { ...DEFAULT_DECODER_SETTINGS, decodeLimit: 3 } });

      const result = decoder.decode(bytes as unknown as Java.Wrapper);

      const expectedHex = toHex(new Uint8Array([0x41, 0x42, 0x43]));
      expect(result).toEqual({ type: "[B", value: expectedHex + "..." });
    });

    it("should not append an ellipsis when the byte array is exactly decodeLimit long", () => {
      const rawBytes = [0x41, 0x42, 0x43];
      const bytes = Java.array("byte", rawBytes);
      const decoder = new HexDecoder({ type: "[B", settings: { ...DEFAULT_DECODER_SETTINGS, decodeLimit: 3 } });

      const result = decoder.decode(bytes as unknown as Java.Wrapper);

      const expectedHex = toHex(new Uint8Array(rawBytes));
      expect(result).toEqual({ type: "[B", value: expectedHex });
    });

    it("should decode a null '[B' byte array without throwing (regression)", () => {
      // a "[B" is a reference type too and can legitimately be null (e.g. an uninitialized
      // output buffer) - readBytesLimited(null, ...), which the "[B" branch relies on, throws
      // rather than producing an empty/null result, so null must be checked before that branch is reached
      const decoder = new HexDecoder({ type: "[B", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "[B", value: null });
    });
  });
});

export {};
