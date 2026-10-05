import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { DecoderArgValues } from "../../shared/decoders/decoderArgs";
import { DecoderSettings } from "../../shared/frookySettings";
import { NativeDecoderResolver } from "./nativeDecoderResolver";

const decode = (type: string, value: NativePointer, args?: DecoderArgValues, settings: Partial<DecoderSettings> = {}) =>
  NativeDecoderResolver.resolveDecoder({ type, settings: { ...DEFAULT_DECODER_SETTINGS, ...settings, decoder: "hex" } }).decode(value, args).value;

const writeBytes = (bytes: number[]): NativePointer => {
  const buffer = Memory.alloc(bytes.length);
  buffer.writeByteArray(bytes);
  return buffer;
};

// a negative int as the CPU passes it: sign-extended to 64 bits
const negative = (n: number): NativePointer => ptr(int64(n).toString());

describe("NativeHexDecoder", () => {
  it("decodes the bytes of a pointer with the role length, NUL bytes included", () => {
    expect(decode("char *", writeBytes([0x48, 0x00, 0x69, 0xff]), { length: 4 })).toBe("0x480069ff");
  });

  it("decodes the bytes up to the NUL byte without the role length", () => {
    expect(decode("const void *", writeBytes([0x48, 0x69, 0x00, 0x21]))).toBe("0x4869");
  });

  it("skips the bytes of the role offset", () => {
    expect(decode("uint8_t *", writeBytes([0x00, 0x00, 0xab, 0xcd]), { offset: 2, length: 2 })).toBe("0xabcd");
  });

  it("decodes at most maxItems bytes and appends an ellipsis", () => {
    expect(decode("SSL *", writeBytes([0x01, 0x02, 0x03, 0x04]), { length: 4 }, { maxItems: 2 })).toBe("0x0102...");
  });

  it("decodes NULL as null", () => {
    expect(decode("void *", NULL, { length: 4 })).toBeNull();
  });

  it("decodes an integer passed by value as hex of its bits at the size of its type", () => {
    expect(decode("int", ptr(255))).toBe("0xff");
    expect(decode("int", negative(-1))).toBe("0xffffffff");
    expect(decode("uint8_t", ptr(0x1ff))).toBe("0xff");
    expect(decode("long", negative(-1))).toBe("0xffffffffffffffff");
    expect(decode("mode_t", ptr(0o644))).toBe("0x1a4");
  });

  // the hook passes a float or double as the bits of its FP register
  it("decodes a float or double as hex of its IEEE 754 bits", () => {
    expect(decode("float", ptr("0x3fc00000"))).toBe("0x3fc00000");
    expect(decode("double", ptr("0xbff0000000000000"))).toBe("0xbff0000000000000");
  });

  it("decodes a float argument that isn't in an FP register as null", () => {
    expect(decode("double", null as unknown as NativePointer)).toBeNull();
  });
});

export {};
