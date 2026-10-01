import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { NativeFlagsPresetName } from "../../shared/frookySettings";
import { DecoderSettings } from "../../shared/frookySettings";
import { decodeFlags } from "../../shared/decoders/constantNames";
import { presetConstants } from "./nativeConstantPresets";
import { NativeDecoderResolver } from "./nativeDecoderResolver";

const decode = (type: string, settings: Partial<DecoderSettings>, value: NativePointer) =>
  NativeDecoderResolver.resolveDecoder({ type, settings: { ...DEFAULT_DECODER_SETTINGS, ...settings } }).decode(value).value;

// a negative int as the CPU passes it: sign-extended to the register size
const negative = (n: number): NativePointer => (Process.pointerSize === 8 ? ptr(int64(n).toString()) : ptr(n >>> 0));

describe("NativeEnumDecoder", () => {
  const constants = { MODE_A: 1, MODE_B: 2, ERROR: -1 };

  it("decodes a value to the name of its constant", () => {
    expect(decode("int", { decoder: "enum", constants }, ptr(2))).toBe("MODE_B");
  });

  it("decodes a negative value", () => {
    expect(decode("int", { decoder: "enum", constants }, negative(-1))).toBe("ERROR");
  });

  it("decodes a value without a constant as the number", () => {
    expect(decode("int", { decoder: "enum", constants }, ptr(7))).toBe(7);
  });

  it("reads a type frooky doesn't know as an int", () => {
    expect(decode("my_mode_t", { decoder: "enum", constants }, negative(-1))).toBe("ERROR");
  });

  it("decodes the value as a number without constants", () => {
    expect(decode("int", { decoder: "enum" }, ptr(2))).toBe(2);
  });

  it("decodes socketDomain", () => {
    expect(decode("int", { decoder: "socketDomain" }, ptr(10))).toBe("AF_INET6");
  });

  it("uses the preset, not the constants of the settings", () => {
    expect(decode("int", { decoder: "socketDomain", constants }, ptr(2))).toBe("AF_INET");
  });
});

describe("NativeFlagsDecoder", () => {
  const constants = { READ: 0x1, WRITE: 0x2, EXEC: 0x4, NONE: 0 };

  it("decodes the names of the bits that are set, in the order of the constants", () => {
    expect(decode("int", { decoder: "flags", constants }, ptr(0x5))).toEqual(["READ", "EXEC"]);
  });

  it("decodes 0 as the constant with value 0", () => {
    expect(decode("int", { decoder: "flags", constants }, ptr(0))).toEqual(["NONE"]);
  });

  it("decodes 0 as an empty list without such a constant", () => {
    expect(decode("int", { decoder: "flags", constants: { READ: 1 } }, ptr(0))).toEqual([]);
  });

  it("adds the bits no constant matches as hex", () => {
    expect(decode("int", { decoder: "flags", constants }, ptr(0x103))).toEqual(["READ", "WRITE", "0x100"]);
  });

  it("matches a constant with several bits first and doesn't repeat its bits", () => {
    const withCombined = { LOW: 0x1, BOTH: 0x3 };
    expect(decode("int", { decoder: "flags", constants: withCombined }, ptr(0x3))).toEqual(["BOTH"]);
  });

  it("only reads the bits of the declared type", () => {
    // an int's upper register bits are undefined
    expect(decode("int", { decoder: "flags", constants }, Process.pointerSize === 8 ? ptr("0xffffffff00000001") : ptr(1))).toEqual(["READ"]);
    expect(decode("uint8_t", { decoder: "flags", constants }, ptr(0x101))).toEqual(["READ"]);
  });

  it("decodes the value as a number without constants", () => {
    expect(decode("int", { decoder: "flags" }, ptr(5))).toBe(5);
  });

  describe("presets", () => {
    const arm = Process.arch === "arm64";

    it("decodes openFlags with its access mode", () => {
      expect(decode("int", { decoder: "openFlags" }, ptr(0x241))).toEqual(["O_WRONLY", "O_CREAT", "O_TRUNC"]);
      expect(decode("int", { decoder: "openFlags" }, ptr(0x0))).toEqual(["O_RDONLY"]);
      expect(decode("int", { decoder: "openFlags" }, ptr(0x80002))).toEqual(["O_RDWR", "O_CLOEXEC"]);
    });

    it("decodes the open flags whose value depends on the architecture", () => {
      expect(decode("int", { decoder: "openFlags" }, ptr(arm ? 0x4000 : 0x10000))).toEqual(["O_RDONLY", "O_DIRECTORY"]);
    });

    it("decodes O_SYNC without O_DSYNC, which it includes", () => {
      expect(decode("int", { decoder: "openFlags" }, ptr(0x101001))).toEqual(["O_WRONLY", "O_SYNC"]);
    });

    it("decodes mmapProt", () => {
      expect(decode("int", { decoder: "mmapProt" }, ptr(0x3))).toEqual(["PROT_READ", "PROT_WRITE"]);
      expect(decode("int", { decoder: "mmapProt" }, ptr(0x0))).toEqual(["PROT_NONE"]);
    });

    it("decodes mmapFlags", () => {
      expect(decode("int", { decoder: "mmapFlags" }, ptr(0x22))).toEqual(["MAP_PRIVATE", "MAP_ANONYMOUS"]);
    });

    it("decodes dlopenFlags", () => {
      expect(decode("int", { decoder: "dlopenFlags" }, ptr(0x102))).toEqual(["RTLD_NOW", "RTLD_GLOBAL"]);
    });

    it("decodes socketType", () => {
      expect(decode("int", { decoder: "socketType" }, ptr(0x80001))).toEqual(["SOCK_STREAM", "SOCK_CLOEXEC"]);
    });
  });

  describe("preset tables per platform", () => {
    const flags = (name: NativeFlagsPresetName, platform: string, arch: string, bits: number) =>
      decodeFlags(uint64(bits), presetConstants(name, platform, arch, 8)!);

    it("has the open flags of Linux per architecture", () => {
      expect(flags("openFlags", "linux", "arm64", 0x4000)).toEqual(["O_RDONLY", "O_DIRECTORY"]);
      expect(flags("openFlags", "linux", "x64", 0x10000)).toEqual(["O_RDONLY", "O_DIRECTORY"]);
    });

    it("has the open flags of Darwin", () => {
      expect(flags("openFlags", "darwin", "arm64", 0x1000601)).toEqual(["O_WRONLY", "O_CREAT", "O_TRUNC", "O_CLOEXEC"]);
      expect(flags("openFlags", "darwin", "arm64", 0x40100000)).toEqual(["O_RDONLY", "O_SEARCH"]);
    });

    it("has the mmap, dlopen and socket constants of Darwin", () => {
      expect(flags("mmapFlags", "darwin", "arm64", 0x1002)).toEqual(["MAP_PRIVATE", "MAP_ANONYMOUS"]);
      expect(flags("mmapProt", "darwin", "arm64", 0x5)).toEqual(["PROT_READ", "PROT_EXEC"]);
      expect(flags("dlopenFlags", "darwin", "arm64", 0xa)).toEqual(["RTLD_NOW", "RTLD_GLOBAL"]);
      expect(flags("socketType", "darwin", "arm64", 0x1)).toEqual(["SOCK_STREAM"]);
      expect(presetConstants("socketDomain", "darwin", "arm64", 8)!.constants.AF_INET6).toBe(30);
    });

    it("has no values for 32-bit processes, other architectures and other platforms", () => {
      expect(presetConstants("openFlags", "linux", "arm", 4)).toBeUndefined();
      expect(presetConstants("openFlags", "linux", "ia32", 4)).toBeUndefined();
      expect(presetConstants("openFlags", "linux", "mips", 8)).toBeUndefined();
      expect(presetConstants("openFlags", "windows", "x64", 8)).toBeUndefined();
    });
  });
});
