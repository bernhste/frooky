import { Decoder } from "../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../shared/decoders/decodedValue";
import { logger } from "../../shared/logger";
import { bytesToString } from "../../shared/utils";
import { decodeConstant } from "../../shared/decoders/constantNames";
import { presetConstants } from "./nativeConstantPresets";

// size of sockaddr_storage
const SOCKADDR_SIZE = 128;

// What differs between Linux (Android) and Darwin (iOS) for file descriptors and sockets
type FdPlatform = {
  // the path of an open fd, null if it has none
  readPath: (fd: number) => string | null;
  solSocket: number;
  soType: number;
  afInet6: number;
  // Linux: `sa_family` is a u16 at offset 0. Darwin: `sa_len` is a u8 at offset 0, `sa_family` a u8 at offset 1.
  readFamily: (address: NativePointer) => number;
  // Linux has AF_UNIX names in the abstract namespace, which start with a NUL byte
  abstractUnixNames: boolean;
};

const PATH_MAX = 4096;
// F_GETPATH writes at most MAXPATHLEN bytes
const DARWIN_MAXPATHLEN = 1024;
const DARWIN_F_GETPATH = 50;

const fn = (name: string) => Module.getGlobalExportByName(name);

let linuxReadlink: NativeFunction<number, [NativePointer, NativePointer, number]> | null = null;
let darwinFcntl: NativeFunction<number, [number, number, NativePointer]> | null = null;

const LINUX: FdPlatform = {
  // e.g. `/data/user/0/<app>/files/a.txt`, `socket:[12345]`, `pipe:[678]` or `anon_inode:[eventfd]`
  readPath: (fd) => {
    linuxReadlink ??= new NativeFunction(fn("readlink"), "int", ["pointer", "pointer", "size_t"]);
    const buffer = Memory.alloc(PATH_MAX);
    const length = linuxReadlink(Memory.allocUtf8String(`/proc/self/fd/${fd}`), buffer, PATH_MAX);
    return length < 0 ? null : bytesToString(new Uint8Array(buffer.readByteArray(length)!));
  },
  solSocket: 1,
  soType: 3,
  afInet6: 10,
  readFamily: (address) => address.readU16(),
  abstractUnixNames: true,
};

const DARWIN: FdPlatform = {
  // files only: F_GETPATH fails for sockets and pipes
  readPath: (fd) => {
    // fcntl is variadic, and arm64 Darwin passes variadic arguments on the stack
    darwinFcntl ??= new NativeFunction(fn("fcntl"), "int", ["int", "int", "...", "pointer"]);
    const buffer = Memory.alloc(DARWIN_MAXPATHLEN);
    if (darwinFcntl(fd, DARWIN_F_GETPATH, buffer) === -1) return null;
    const bytes = new Uint8Array(buffer.readByteArray(DARWIN_MAXPATHLEN)!);
    const end = bytes.indexOf(0);
    return bytesToString(end === -1 ? bytes : bytes.subarray(0, end));
  },
  solSocket: 0xffff,
  soType: 0x1008,
  afInet6: 30,
  readFamily: (address) => address.add(1).readU8(),
  abstractUnixNames: false,
};

const AF_UNIX = 1;
const AF_INET = 2;

const fdPlatform = (platform: string): FdPlatform => (platform === "darwin" ? DARWIN : LINUX);

// e.g. `2001:db8::1`, with the longest run of zero groups shortened to `::`, and `::ffff:1.2.3.4` for a mapped IPv4 address
export function formatIpv6(bytes: Uint8Array): string {
  if (bytes.subarray(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return `::ffff:${Array.from(bytes.subarray(12, 16)).join(".")}`;
  }
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);

  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart === -1) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;
}

// A socket address as text: `127.0.0.1:8080`, `[::1]:8080`, a path for AF_UNIX (`@name` if it is in the abstract
// namespace of Linux). Null for an unnamed AF_UNIX socket, the family number for other families. The port and the
// addresses have the same offsets on Linux and Darwin.
export function formatSockaddr(address: NativePointer, length: number, platform: string = Process.platform): string | number | null {
  if (length < 2) return null;
  const p = fdPlatform(platform);
  const family = p.readFamily(address);
  const port = (): number => (address.add(2).readU8() << 8) | address.add(3).readU8();
  if (family === AF_INET && length >= 8) {
    return `${Array.from(new Uint8Array(address.add(4).readByteArray(4)!)).join(".")}:${port()}`;
  }
  if (family === p.afInet6 && length >= 24) {
    return `[${formatIpv6(new Uint8Array(address.add(8).readByteArray(16)!))}]:${port()}`;
  }
  if (family === AF_UNIX) {
    if (length <= 2) return null;
    const path = new Uint8Array(address.add(2).readByteArray(length - 2)!);
    if (path[0] === 0) {
      return p.abstractUnixNames ? "@" + bytesToString(path.subarray(1)) : null;
    }
    const end = path.indexOf(0);
    return bytesToString(end === -1 ? path : path.subarray(0, end));
  }
  return family;
}

type SocketFunction = NativeFunction<number, [number, NativePointer, NativePointer]>;

let getsockname: SocketFunction | null = null;
let getpeername: SocketFunction | null = null;
let getsockopt: NativeFunction<number, [number, number, number, NativePointer, NativePointer]> | null = null;

// What `getsockname`/`getpeername` return, null if it fails: for an fd that is no socket, or for the peer of an
// unconnected socket.
function socketAddress(get: SocketFunction, fd: number, p: FdPlatform): { family: number; address: string | number | null } | null {
  const address = Memory.alloc(SOCKADDR_SIZE);
  const length = Memory.alloc(4);
  length.writeU32(SOCKADDR_SIZE);
  if (get(fd, address, length) !== 0) return null;
  const actualLength = Math.min(length.readU32(), SOCKADDR_SIZE);
  return { family: actualLength >= 2 ? p.readFamily(address) : 0, address: formatSockaddr(address, actualLength) };
}

export type DecodedFd = {
  fd: number;
  path: string | null;
  family?: string | number;
  socketType?: string | number;
  local?: string | number | null;
  peer?: string | number | null;
};

// `decoder: fd`: what an `int` file descriptor refers to. Only reads it, the fd is unchanged.
export function decodeFd(fd: number): DecodedFd {
  if (fd < 0) return { fd, path: null };
  const p = fdPlatform(Process.platform);
  const decoded: DecodedFd = { fd, path: p.readPath(fd) };

  getsockname ??= new NativeFunction(fn("getsockname"), "int", ["int", "pointer", "pointer"]);
  const local = socketAddress(getsockname, fd, p);
  if (!local) return decoded;

  const families = presetConstants("socketDomain")?.constants ?? {};
  decoded.family = decodeConstant(local.family, families);
  getsockopt ??= new NativeFunction(fn("getsockopt"), "int", ["int", "int", "int", "pointer", "pointer"]);
  const type = Memory.alloc(4);
  const typeLength = Memory.alloc(4);
  typeLength.writeU32(4);
  if (getsockopt(fd, p.solSocket, p.soType, type, typeLength) === 0) {
    decoded.socketType = decodeConstant(type.readS32(), presetConstants("socketType")?.enumConstants ?? {});
  }
  decoded.local = local.address;
  getpeername ??= new NativeFunction(fn("getpeername"), "int", ["int", "pointer", "pointer"]);
  decoded.peer = socketAddress(getpeername, fd, p)?.address ?? null;
  return decoded;
}

export class NativeFdDecoder extends Decoder<NativePointer> {
  readonly decoderName = "NativeFdDecoder";
  readonly description =
    "Decodes an `int` file descriptor to the file, socket or pipe it refers to, and for a socket its family, type, local and peer address.";

  public decode(value: NativePointer): DecodedValue {
    const fd = value.toInt32();
    let decoded: DecodedFd;
    try {
      decoded = decodeFd(fd);
    } catch (e) {
      logger.warn(`Unable to decode file descriptor ${fd}: ${e}`);
      decoded = { fd, path: null };
    }
    return { type: this.type, name: this.name, value: decoded };
  }
}
