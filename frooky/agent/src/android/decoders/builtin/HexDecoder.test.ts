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

    it("should truncate a '[B' byte array longer than maxItems and append an ellipsis", () => {
      const rawBytes = [0x41, 0x42, 0x43, 0x44, 0x45];
      const bytes = Java.array("byte", rawBytes);
      const decoder = new HexDecoder({ type: "[B", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 3 } });

      const result = decoder.decode(bytes as unknown as Java.Wrapper);

      const expectedHex = toHex(new Uint8Array([0x41, 0x42, 0x43]));
      expect(result).toEqual({ type: "[B", value: expectedHex + "..." });
    });

    it("should not append an ellipsis when the byte array is exactly maxItems long", () => {
      const rawBytes = [0x41, 0x42, 0x43];
      const bytes = Java.array("byte", rawBytes);
      const decoder = new HexDecoder({ type: "[B", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 3 } });

      const result = decoder.decode(bytes as unknown as Java.Wrapper);

      const expectedHex = toHex(new Uint8Array(rawBytes));
      expect(result).toEqual({ type: "[B", value: expectedHex });
    });

    it("should decode a null '[B' byte array without throwing", () => {
      const decoder = new HexDecoder({ type: "[B", settings: DEFAULT_DECODER_SETTINGS });

      const result = decoder.decode(null as unknown as Java.Wrapper);

      expect(result).toEqual({ type: "[B", value: null });
    });

    it("should decode the slice of a '[B' that the roles select", () => {
      const bytes = Java.array("byte", [0x00, 0x41, 0x42, 0x43, 0x00]);
      const decoder = new HexDecoder({ type: "[B", settings: DEFAULT_DECODER_SETTINGS });

      expect(decoder.decode(bytes as unknown as Java.Wrapper, { offset: 1, length: 3 }).value).toBe("0x414243");
    });

    it("should decode an integer as hex of its bits at the size of its type", () => {
      const hex = (type: string, value: unknown) => new HexDecoder({ type, settings: DEFAULT_DECODER_SETTINGS }).decode(value as Java.Wrapper).value;

      expect(hex("int", 255)).toBe("0xff");
      expect(hex("int", -1)).toBe("0xffffffff");
      expect(hex("byte", -1)).toBe("0xff");
      expect(hex("short", -2)).toBe("0xfffe");
      expect(hex("char", "A")).toBe("0x41");
      expect(hex("long", int64("-1"))).toBe("0xffffffffffffffff");
      expect(hex("long", 5000000000)).toBe("0x12a05f200");
    });

    it("should decode an array of other integers as a list of them in hex, up to maxItems", () => {
      const ints = Java.array("int", [0x48, -1, 0x6c]);
      const decoder = new HexDecoder({ type: "[I", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 2 } });

      expect(decoder.decode(ints as unknown as Java.Wrapper).value).toEqual(["0x48", "0xffffffff", "[truncated at 2]"]);
    });

    it("should decode a '[C' and a '[J' element by element", () => {
      const chars = Java.array("char", ["A", "z"]);
      const longs = Java.array("long", [1, -1]);

      expect(new HexDecoder({ type: "[C", settings: DEFAULT_DECODER_SETTINGS }).decode(chars as unknown as Java.Wrapper).value).toEqual([
        "0x41",
        "0x7a",
      ]);
      expect(new HexDecoder({ type: "[J", settings: DEFAULT_DECODER_SETTINGS }).decode(longs as unknown as Java.Wrapper).value).toEqual([
        "0x1",
        "0xffffffffffffffff",
      ]);
    });

    it("should decode a float or double as hex of its IEEE 754 bits", () => {
      const hex = (type: string, value: unknown) => new HexDecoder({ type, settings: DEFAULT_DECODER_SETTINGS }).decode(value as Java.Wrapper).value;

      expect(hex("float", 1.5)).toBe("0x3fc00000");
      expect(hex("float", -0)).toBe("0x80000000");
      expect(hex("double", 1.5)).toBe("0x3ff8000000000000");
      expect(hex("double", -1)).toBe("0xbff0000000000000");
    });

    it("should decode a '[F' and a '[D' element by element", () => {
      const floats = Java.array("float", [1.5, -2]);
      const doubles = Java.array("double", [1.5]);

      expect(new HexDecoder({ type: "[F", settings: DEFAULT_DECODER_SETTINGS }).decode(floats as unknown as Java.Wrapper).value).toEqual([
        "0x3fc00000",
        "0xc0000000",
      ]);
      expect(new HexDecoder({ type: "[D", settings: DEFAULT_DECODER_SETTINGS }).decode(doubles as unknown as Java.Wrapper).value).toEqual([
        "0x3ff8000000000000",
      ]);
    });

    it("should throw for a value that is no number, so the default decoder takes over", () => {
      expect(() =>
        new HexDecoder({ type: "java.lang.String", settings: DEFAULT_DECODER_SETTINGS }).decode("abc" as unknown as Java.Wrapper),
      ).toThrow();
      expect(() => new HexDecoder({ type: "boolean", settings: DEFAULT_DECODER_SETTINGS }).decode(true as unknown as Java.Wrapper)).toThrow();
    });
  });
});

export {};
