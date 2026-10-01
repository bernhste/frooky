import { logger } from "../../shared/logger";
import { ConstantSet } from "../../shared/decoders/constantNames";

// Constants of system calls and libc for 64-bit processes, one table per platform:
// - linux: Android (and Linux), from the Linux UAPI headers and Bionic. The kernel keeps the values stable per
//   architecture; a few `O_*` flags differ between arm64 and x86_64.
// - darwin: iOS (and macOS), from the XNU and libSystem headers. The values are the same on every architecture.
type Arch = "arm64" | "x64";

type Preset = {
  kind: "flags" | "enum";
  linux: (arch: Arch) => ConstantSet;
  darwin: () => ConstantSet;
};

// open(2), openat(2): the access mode is the lowest two bits, the rest are flags
const ACCESS_MODES = { O_RDONLY: 0x0, O_WRONLY: 0x1, O_RDWR: 0x2 };

const openFlags: Preset = {
  kind: "flags",
  linux: (arch) => {
    const arm = arch === "arm64";
    return {
      enumMask: 0x3,
      enumConstants: ACCESS_MODES,
      constants: {
        O_CREAT: 0x40,
        O_EXCL: 0x80,
        O_NOCTTY: 0x100,
        O_TRUNC: 0x200,
        O_APPEND: 0x400,
        O_NONBLOCK: 0x800,
        O_DSYNC: 0x1000,
        O_ASYNC: 0x2000,
        O_DIRECT: arm ? 0x10000 : 0x4000,
        O_LARGEFILE: arm ? 0x20000 : 0x8000,
        O_DIRECTORY: arm ? 0x4000 : 0x10000,
        O_NOFOLLOW: arm ? 0x8000 : 0x20000,
        O_NOATIME: 0x40000,
        O_CLOEXEC: 0x80000,
        // includes O_DSYNC
        O_SYNC: 0x101000,
        O_PATH: 0x200000,
        // includes O_DIRECTORY
        O_TMPFILE: 0x400000 | (arm ? 0x4000 : 0x10000),
      },
    };
  },
  darwin: () => ({
    enumMask: 0x3,
    enumConstants: ACCESS_MODES,
    constants: {
      O_NONBLOCK: 0x4,
      O_APPEND: 0x8,
      O_SHLOCK: 0x10,
      O_EXLOCK: 0x20,
      O_ASYNC: 0x40,
      O_SYNC: 0x80,
      O_NOFOLLOW: 0x100,
      O_CREAT: 0x200,
      O_TRUNC: 0x400,
      O_EXCL: 0x800,
      O_EVTONLY: 0x8000,
      O_NOCTTY: 0x20000,
      O_DIRECTORY: 0x100000,
      O_SYMLINK: 0x200000,
      O_DSYNC: 0x400000,
      O_CLOEXEC: 0x1000000,
      O_NOFOLLOW_ANY: 0x20000000,
      O_EXEC: 0x40000000,
      // includes O_DIRECTORY
      O_SEARCH: 0x40100000,
    },
  }),
};

// mmap(2), mprotect(2)
const PROT = { PROT_NONE: 0x0, PROT_READ: 0x1, PROT_WRITE: 0x2, PROT_EXEC: 0x4 };
const mmapProt: Preset = { kind: "flags", linux: () => ({ constants: PROT }), darwin: () => ({ constants: PROT }) };

// mmap(2): the sharing type is the lowest two bits
const mmapFlags: Preset = {
  kind: "flags",
  linux: () => ({
    enumMask: 0x3,
    enumConstants: { MAP_SHARED: 0x1, MAP_PRIVATE: 0x2, MAP_SHARED_VALIDATE: 0x3 },
    constants: {
      MAP_FIXED: 0x10,
      MAP_ANONYMOUS: 0x20,
      MAP_GROWSDOWN: 0x100,
      MAP_DENYWRITE: 0x800,
      MAP_EXECUTABLE: 0x1000,
      MAP_LOCKED: 0x2000,
      MAP_NORESERVE: 0x4000,
      MAP_POPULATE: 0x8000,
      MAP_NONBLOCK: 0x10000,
      MAP_STACK: 0x20000,
      MAP_HUGETLB: 0x40000,
      MAP_FIXED_NOREPLACE: 0x100000,
    },
  }),
  darwin: () => ({
    enumMask: 0x3,
    enumConstants: { MAP_SHARED: 0x1, MAP_PRIVATE: 0x2 },
    constants: {
      MAP_FIXED: 0x10,
      MAP_RENAME: 0x20,
      MAP_NORESERVE: 0x40,
      MAP_NOEXTEND: 0x100,
      MAP_HASSEMAPHORE: 0x200,
      MAP_NOCACHE: 0x400,
      MAP_JIT: 0x800,
      // MAP_ANON in the headers, with MAP_ANONYMOUS as an alias
      MAP_ANONYMOUS: 0x1000,
      MAP_RESILIENT_CODESIGN: 0x2000,
      MAP_RESILIENT_MEDIA: 0x4000,
    },
  }),
};

// dlopen(3)
const dlopenFlags: Preset = {
  kind: "flags",
  linux: () => ({ constants: { RTLD_LAZY: 0x1, RTLD_NOW: 0x2, RTLD_NOLOAD: 0x4, RTLD_GLOBAL: 0x100, RTLD_NODELETE: 0x1000, RTLD_LOCAL: 0x0 } }),
  darwin: () => ({
    constants: { RTLD_LAZY: 0x1, RTLD_NOW: 0x2, RTLD_LOCAL: 0x4, RTLD_GLOBAL: 0x8, RTLD_NOLOAD: 0x10, RTLD_NODELETE: 0x80, RTLD_FIRST: 0x100 },
  }),
};

// socket(2): the `domain`
const socketDomain: Preset = {
  kind: "enum",
  linux: () => ({ constants: { AF_UNSPEC: 0, AF_UNIX: 1, AF_INET: 2, AF_INET6: 10, AF_NETLINK: 16, AF_PACKET: 17, AF_BLUETOOTH: 31, AF_VSOCK: 40 } }),
  darwin: () => ({ constants: { AF_UNSPEC: 0, AF_UNIX: 1, AF_INET: 2, AF_ROUTE: 17, AF_LINK: 18, AF_INET6: 30, AF_SYSTEM: 32, AF_VSOCK: 40 } }),
};

// socket(2): the `type`. Linux adds flags above the socket type, Darwin has none.
const SOCKET_TYPES = { SOCK_STREAM: 1, SOCK_DGRAM: 2, SOCK_RAW: 3, SOCK_RDM: 4, SOCK_SEQPACKET: 5 };
const socketType: Preset = {
  kind: "flags",
  linux: () => ({ enumMask: 0xf, enumConstants: { ...SOCKET_TYPES, SOCK_PACKET: 10 }, constants: { SOCK_NONBLOCK: 0x800, SOCK_CLOEXEC: 0x80000 } }),
  darwin: () => ({ enumMask: 0xf, enumConstants: SOCKET_TYPES, constants: {} }),
};

const PRESETS: Record<string, Preset> = { openFlags, mmapProt, mmapFlags, dlopenFlags, socketDomain, socketType };

export const FLAG_PRESET_NAMES = Object.keys(PRESETS).filter((name) => PRESETS[name].kind === "flags");
export const ENUM_PRESET_NAMES = Object.keys(PRESETS).filter((name) => PRESETS[name].kind === "enum");

// The constants of a preset, undefined where frooky has no values: other platforms than Android/Linux and
// iOS/macOS, 32-bit processes, and other architectures than arm64 and x86_64 on Linux.
export function presetConstants(
  name: string,
  platform: string = Process.platform,
  arch: string = Process.arch,
  pointerSize: number = Process.pointerSize,
): ConstantSet | undefined {
  const preset = PRESETS[name];
  if (!preset || pointerSize !== 8) return undefined;
  if (platform === "darwin") return preset.darwin();
  if (platform === "linux" && (arch === "arm64" || arch === "x64")) return preset.linux(arch);
  return undefined;
}

// presetConstants() of this process, with a warning if there are none
export function resolvePreset(name: string): ConstantSet | undefined {
  const constants = presetConstants(name);
  if (!constants) {
    logger.warn(
      `decoder: ${name} has values for 64-bit Android and iOS, but this process is ${Process.platform} ${Process.arch} (${Process.pointerSize * 8}-bit). The value is decoded as a number.`,
    );
  }
  return constants;
}
