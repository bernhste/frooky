import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { DecoderSettings } from "../../shared/frookySettings";
import { acceptedNativeDecoderArgs, NativeDecoderResolver } from "./nativeDecoderResolver";
import { isUtf16PointerType, NativeUtf16Decoder } from "./nativeUtf16Decoder";

// UTF-16LE code units of `text`, without a terminator unless it contains one
const utf16 = (text: string): NativePointer => {
  const buffer = Memory.alloc(text.length * 2 + 2);
  for (let i = 0; i < text.length; i++) buffer.add(i * 2).writeU16(text.charCodeAt(i));
  return buffer;
};

const decode = (value: NativePointer, args?: Record<string, unknown>, settings: Partial<DecoderSettings> = {}) =>
  new NativeUtf16Decoder({ type: "const jchar *", settings: { ...DEFAULT_DECODER_SETTINGS, ...settings } }).decode(value, args).value;

describe("NativeUtf16Decoder", () => {
  it("decodes a string up to its 0 code unit", () => {
    expect(decode(utf16("Grüße 📱\0rest"))).toBe("Grüße 📱");
  });

  it("decodes exactly the code units of the role length, also past a 0 unit", () => {
    expect(decode(utf16("abc\0de"), { length: 3 })).toBe("abc");
    expect(decode(utf16("ab\0cd"), { length: 5 })).toBe("ab\0cd");
  });

  it("skips the code units of the role offset", () => {
    expect(decode(utf16("--hello--\0"), { offset: 2, length: 5 })).toBe("hello");
    expect(decode(utf16("--hello\0"), { offset: 2 })).toBe("hello");
  });

  it("cuts a string at maxItems code units, without splitting a surrogate pair", () => {
    expect(decode(utf16("abcdef\0"), undefined, { maxItems: 3 })).toBe("abc...");
    expect(decode(utf16("ab📱cd\0"), undefined, { maxItems: 3 })).toBe("ab...");
    expect(decode(utf16("abcdef"), { length: 6 }, { maxItems: 4 })).toBe("abcd...");
  });

  it("decodes NULL as null, and an invalid length as null", () => {
    expect(decode(ptr(0))).toBeNull();
    expect(decode(utf16("abc\0"), { length: -1 })).toBeNull();
  });

  it("is the default decoder of UTF-16 pointer types, and of decoder: utf16", () => {
    const resolve = (type: string, decoder?: string) =>
      NativeDecoderResolver.resolveDecoder({ type, settings: { ...DEFAULT_DECODER_SETTINGS, decoder } }) instanceof NativeUtf16Decoder;
    expect(resolve("const char16_t *")).toBe(true);
    expect(resolve("jchar*")).toBe(true);
    expect(resolve("const UniChar *")).toBe(true);
    expect(resolve("UChar *")).toBe(true);
    expect(resolve("uint16_t *", "utf16")).toBe(true);
    // `uchar *` is `unsigned char *`
    expect(resolve("uchar *")).toBe(false);
    expect(resolve("wchar_t *")).toBe(false);
  });

  it("accepts the roles length and offset", () => {
    expect(acceptedNativeDecoderArgs({ type: "const jchar *", settings: DEFAULT_DECODER_SETTINGS })).toEqual(["length", "offset"]);
    expect(acceptedNativeDecoderArgs({ type: "void *", settings: { ...DEFAULT_DECODER_SETTINGS, decoder: "utf16" } })).toEqual(["length", "offset"]);
  });

  it("recognizes the UTF-16 pointer types", () => {
    expect(isUtf16PointerType("const unichar *")).toBe(true);
    expect(isUtf16PointerType("jchar **")).toBe(false);
    expect(isUtf16PointerType("jchar")).toBe(false);
  });
});
