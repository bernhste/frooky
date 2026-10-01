import { Decoder } from "../../shared/decoders/baseDecoder";
import { Decodable } from "../../shared/decoders/decodable";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { logger } from "../../shared/logger";
import { parseNativeFridaType } from "./nativeFridaType";

// errno values 1 to 34 are the same on Linux and Darwin, except 11
const COMMON_ERRNO_NAMES: Record<number, string> = {
  1: "EPERM",
  2: "ENOENT",
  3: "ESRCH",
  4: "EINTR",
  5: "EIO",
  6: "ENXIO",
  7: "E2BIG",
  8: "ENOEXEC",
  9: "EBADF",
  10: "ECHILD",
  12: "ENOMEM",
  13: "EACCES",
  14: "EFAULT",
  15: "ENOTBLK",
  16: "EBUSY",
  17: "EEXIST",
  18: "EXDEV",
  19: "ENODEV",
  20: "ENOTDIR",
  21: "EISDIR",
  22: "EINVAL",
  23: "ENFILE",
  24: "EMFILE",
  25: "ENOTTY",
  26: "ETXTBSY",
  27: "EFBIG",
  28: "ENOSPC",
  29: "ESPIPE",
  30: "EROFS",
  31: "EMLINK",
  32: "EPIPE",
  33: "EDOM",
  34: "ERANGE",
};

// Android (and Linux), from the Linux UAPI headers
const LINUX_ERRNO_NAMES: Record<number, string> = {
  ...COMMON_ERRNO_NAMES,
  11: "EAGAIN",
  35: "EDEADLK",
  36: "ENAMETOOLONG",
  37: "ENOLCK",
  38: "ENOSYS",
  39: "ENOTEMPTY",
  40: "ELOOP",
  61: "ENODATA",
  62: "ETIME",
  75: "EOVERFLOW",
  84: "EILSEQ",
  88: "ENOTSOCK",
  89: "EDESTADDRREQ",
  90: "EMSGSIZE",
  91: "EPROTOTYPE",
  92: "ENOPROTOOPT",
  93: "EPROTONOSUPPORT",
  94: "ESOCKTNOSUPPORT",
  95: "EOPNOTSUPP",
  96: "EPFNOSUPPORT",
  97: "EAFNOSUPPORT",
  98: "EADDRINUSE",
  99: "EADDRNOTAVAIL",
  100: "ENETDOWN",
  101: "ENETUNREACH",
  102: "ENETRESET",
  103: "ECONNABORTED",
  104: "ECONNRESET",
  105: "ENOBUFS",
  106: "EISCONN",
  107: "ENOTCONN",
  108: "ESHUTDOWN",
  109: "ETOOMANYREFS",
  110: "ETIMEDOUT",
  111: "ECONNREFUSED",
  112: "EHOSTDOWN",
  113: "EHOSTUNREACH",
  114: "EALREADY",
  115: "EINPROGRESS",
  122: "EDQUOT",
  125: "ECANCELED",
};

// iOS (and macOS), from the XNU headers
const DARWIN_ERRNO_NAMES: Record<number, string> = {
  ...COMMON_ERRNO_NAMES,
  11: "EDEADLK",
  35: "EAGAIN",
  36: "EINPROGRESS",
  37: "EALREADY",
  38: "ENOTSOCK",
  39: "EDESTADDRREQ",
  40: "EMSGSIZE",
  41: "EPROTOTYPE",
  42: "ENOPROTOOPT",
  43: "EPROTONOSUPPORT",
  44: "ESOCKTNOSUPPORT",
  45: "ENOTSUP",
  46: "EPFNOSUPPORT",
  47: "EAFNOSUPPORT",
  48: "EADDRINUSE",
  49: "EADDRNOTAVAIL",
  50: "ENETDOWN",
  51: "ENETUNREACH",
  52: "ENETRESET",
  53: "ECONNABORTED",
  54: "ECONNRESET",
  55: "ENOBUFS",
  56: "EISCONN",
  57: "ENOTCONN",
  58: "ESHUTDOWN",
  59: "ETOOMANYREFS",
  60: "ETIMEDOUT",
  61: "ECONNREFUSED",
  62: "ELOOP",
  63: "ENAMETOOLONG",
  64: "EHOSTDOWN",
  65: "EHOSTUNREACH",
  66: "ENOTEMPTY",
  69: "EDQUOT",
  70: "ESTALE",
  77: "ENOLCK",
  78: "ENOSYS",
};

// The name of an errno value, e.g. `ENOENT`, null for a value not in the table of the platform
export function errnoName(errno: number, platform: string = Process.platform): string | null {
  return (platform === "darwin" ? DARWIN_ERRNO_NAMES : LINUX_ERRNO_NAMES)[errno] ?? null;
}

let strerror: NativeFunction<NativePointer, [number]> | null = null;

// The message of the C library, e.g. "No such file or directory"
function errnoMessage(errno: number): string | null {
  try {
    strerror ??= new NativeFunction(Module.getGlobalExportByName("strerror"), "pointer", ["int"]);
    return strerror(errno).readUtf8String();
  } catch (e) {
    logger.debug(`strerror(${errno}) failed: ${e}`);
    return null;
  }
}

export type DecodedErrno = { number: number; name: string | null; message: string | null };

const BYTE_SIZE_64 = new Set(["int64", "uint64", "long", "ulong", "size_t", "ssize_t"]);

// `decoder: errno` on the return value: the return value, decoded as its declared type, and `errno` if the
// return value reports an error by the POSIX convention: -1, or NULL or MAP_FAILED for a pointer.
export class NativeErrnoDecoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeErrnoDecoder";
  readonly description = "Decodes the return value and, if it is -1 or NULL, the `errno` the function set, e.g. `ENOENT`.";

  private readonly valueDecoder: Decoder<NativePointer>;
  private readonly isPointer: boolean;
  private readonly allOnes: NativePointer;

  // `valueDecoder` decodes the return value itself, the default decoder of its type
  constructor(decodable: Decodable, valueDecoder: Decoder<NativePointer>) {
    super(decodable);
    this.valueDecoder = valueDecoder;
    this.isPointer = decodable.type.includes("*");
    const fridaType = parseNativeFridaType(decodable.type);
    const size = this.isPointer || (typeof fridaType === "string" && BYTE_SIZE_64.has(fridaType)) ? Process.pointerSize : 4;
    this.allOnes = size === 8 ? ptr("0xffffffffffffffff") : ptr("0xffffffff");
  }

  // whether the return value is -1 (in the size of its type), NULL or MAP_FAILED
  private isError(value: NativePointer): boolean {
    if (this.isPointer && value.isNull()) return true;
    return value.and(this.allOnes).equals(this.allOnes);
  }

  // Without the errno of the call, e.g. on a parameter, only the value is decoded
  public decode(value: NativePointer): DecodedValue {
    return { type: this.type, name: this.name, value: { value: this.valueDecoder.decode(value).value, errno: null } };
  }

  // `errno` must be read right after the call, before anything else can change it
  public decodeWithErrno(value: NativePointer, errno: number): DecodedValue {
    const decodedErrno: DecodedErrno | null = this.isError(value) ? { number: errno, name: errnoName(errno), message: errnoMessage(errno) } : null;
    return { type: this.type, name: this.name, value: { value: this.valueDecoder.decode(value).value, errno: decodedErrno } };
  }
}
