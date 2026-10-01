import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { FlagsDecoder } from "./FlagsDecoder";

const PURPOSES = { PURPOSE_ENCRYPT: 1, PURPOSE_DECRYPT: 2, PURPOSE_SIGN: 4, PURPOSE_VERIFY: 8 };

// `constants: null` decodes without constants
const decode = (type: string, value: unknown, constants: Record<string, number> | null = PURPOSES) =>
  new FlagsDecoder({ type, settings: { ...DEFAULT_DECODER_SETTINGS, constants: constants ?? undefined } }).decode(value as Java.Wrapper).value;

describe("FlagsDecoder", () => {
  it("decodes an int to the names of its bits, in the order of the constants", () => {
    expect(decode("int", 3)).toEqual(["PURPOSE_ENCRYPT", "PURPOSE_DECRYPT"]);
    expect(decode("int", 12)).toEqual(["PURPOSE_SIGN", "PURPOSE_VERIFY"]);
  });

  it("adds bits without a constant as hex", () => {
    expect(decode("int", 0x101)).toEqual(["PURPOSE_ENCRYPT", "0x100"]);
  });

  it("reads a negative int as its 32 bits", () => {
    expect(decode("int", -2147483647, { HIGH: 0x80000000, LOW: 1 })).toEqual(["HIGH", "LOW"]);
  });

  it("reads a long, also with the sign bit set", () => {
    expect(decode("long", 0x100000001, { BIT_32: 0x100000000, BIT_0: 1 })).toEqual(["BIT_32", "BIT_0"]);
    expect(decode("long", "-9223372036854775807", { BIT_0: 1 })).toEqual(["BIT_0", "0x8000000000000000"]);
  });

  it("decodes 0 as the constant with value 0, or as an empty list", () => {
    expect(decode("int", 0, { NONE: 0, A: 1 })).toEqual(["NONE"]);
    expect(decode("int", 0)).toEqual([]);
  });

  it("returns the value as is without constants or for a value that is no integer", () => {
    expect(decode("int", 3, null)).toBe(3);
    expect(decode("java.lang.String", "abc")).toBe("abc");
  });
});
