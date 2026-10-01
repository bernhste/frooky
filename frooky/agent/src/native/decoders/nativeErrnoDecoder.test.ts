import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { NativeDecoderResolver } from "./nativeDecoderResolver";
import { errnoName, NativeErrnoDecoder } from "./nativeErrnoDecoder";

const errnoDecoder = (type: string): NativeErrnoDecoder =>
  NativeDecoderResolver.resolveDecoder({ type, settings: { ...DEFAULT_DECODER_SETTINGS, decoder: "errno" } }) as NativeErrnoDecoder;

const ENOENT = { number: 2, name: "ENOENT", message: "No such file or directory" };

describe("NativeErrnoDecoder", () => {
  it("decodes the errno of an int return value of -1", () => {
    expect(errnoDecoder("int").decodeWithErrno(ptr("0xffffffff"), 2).value).toEqual({ value: -1, errno: ENOENT });
  });

  it("decodes no errno for other return values, since errno is only set on an error", () => {
    expect(errnoDecoder("int").decodeWithErrno(ptr(3), 2).value).toEqual({ value: 3, errno: null });
    expect(errnoDecoder("int").decodeWithErrno(ptr(0), 2).value).toEqual({ value: 0, errno: null });
  });

  it("compares -1 in the size of the return type", () => {
    // an int's upper register bits are undefined, a ssize_t of -1 has all 64 bits set
    expect(errnoDecoder("int").decodeWithErrno(ptr("0x12345678ffffffff"), 2).value).toEqual({ value: -1, errno: ENOENT });
    expect(errnoDecoder("ssize_t").decodeWithErrno(ptr("0xffffffff"), 2).value).toEqual({ value: "4294967295", errno: null });
    expect(errnoDecoder("ssize_t").decodeWithErrno(ptr("0xffffffffffffffff"), 2).value).toEqual({ value: "-1", errno: ENOENT });
  });

  it("decodes the errno of a pointer return value of NULL or MAP_FAILED", () => {
    expect(errnoDecoder("FILE *").decodeWithErrno(ptr(0), 13).value).toEqual({
      value: "0x0",
      errno: { number: 13, name: "EACCES", message: "Permission denied" },
    });
    expect(errnoDecoder("void *").decodeWithErrno(ptr("0xffffffffffffffff"), 12).value).toEqual({
      value: "0xffffffffffffffff",
      errno: { number: 12, name: "ENOMEM", message: "Out of memory" },
    });
    expect(errnoDecoder("char *").decodeWithErrno(Memory.allocUtf8String("/data"), 2).value).toEqual({ value: "/data", errno: null });
  });

  it("decodes the value without errno outside of a return value", () => {
    expect(errnoDecoder("int").decode(ptr("0xffffffff")).value).toEqual({ value: -1, errno: null });
  });
});

describe("errnoName()", () => {
  it("has the names of each platform, which differ above 34", () => {
    expect(errnoName(2, "linux")).toBe("ENOENT");
    expect(errnoName(11, "linux")).toBe("EAGAIN");
    expect(errnoName(11, "darwin")).toBe("EDEADLK");
    expect(errnoName(111, "linux")).toBe("ECONNREFUSED");
    expect(errnoName(61, "darwin")).toBe("ECONNREFUSED");
    expect(errnoName(9999, "linux")).toBeNull();
  });
});
