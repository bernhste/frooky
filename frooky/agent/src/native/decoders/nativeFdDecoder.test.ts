import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { NativeDecoderResolver } from "./nativeDecoderResolver";
import { formatIpv6, formatSockaddr } from "./nativeFdDecoder";

const libcFunction = <R extends NativeFunctionReturnType, A extends NativeFunctionArgumentType[] | []>(name: string, ret: R, args: A) =>
  new NativeFunction(Module.getGlobalExportByName(name), ret, args);

const open = libcFunction("open", "int", ["pointer", "int"]);
const close = libcFunction("close", "int", ["int"]);
const socket = libcFunction("socket", "int", ["int", "int", "int"]);
const bind = libcFunction("bind", "int", ["int", "pointer", "uint"]);
const connect = libcFunction("connect", "int", ["int", "pointer", "uint"]);
const pipe = libcFunction("pipe", "int", ["pointer"]);

const decodeFd = (fd: number) =>
  NativeDecoderResolver.resolveDecoder({ type: "int", settings: { ...DEFAULT_DECODER_SETTINGS, decoder: "fd" } }).decode(ptr(fd));

// sockaddr_in for 127.0.0.1:port
const loopback = (port: number): NativePointer => {
  const address = Memory.alloc(16);
  address.writeU16(2);
  address.add(2).writeU8(port >> 8);
  address.add(3).writeU8(port & 0xff);
  address.add(4).writeByteArray([127, 0, 0, 1]);
  return address;
};

describe("NativeFdDecoder", () => {
  const opened: number[] = [];
  const track = (fd: number): number => {
    opened.push(fd);
    return fd;
  };
  afterAll(() => opened.forEach((fd) => close(fd)));

  it("decodes the path of a file", () => {
    const fd = track(open(Memory.allocUtf8String("/dev/null"), 0));

    expect(decodeFd(fd)).toEqual({ type: "int", value: { fd, path: "/dev/null" } });
  });

  it("decodes a pipe", () => {
    const fds = Memory.alloc(8);
    pipe(fds);
    const fd = track(fds.readS32());
    track(fds.add(4).readS32());

    expect(/^pipe:\[\d+\]$/.test(String((decodeFd(fd).value as { path: string }).path))).toBe(true);
  });

  it("decodes a negative fd, e.g. -1 when open fails, without a path", () => {
    expect(decodeFd(-1).value).toEqual({ fd: -1, path: null });
  });

  it("decodes an fd that isn't open without a path", () => {
    expect(decodeFd(65000).value).toEqual({ fd: 65000, path: null });
  });

  it("decodes a connected UDP socket with its addresses", () => {
    const fd = track(socket(2, 2, 0));
    expect(fd >= 0).toBe(true);
    expect(connect(fd, loopback(9), 16)).toBe(0);

    const decoded = decodeFd(fd).value as Record<string, unknown>;
    expect(/^socket:\[\d+\]$/.test(String(decoded.path))).toBe(true);
    expect(decoded.family).toBe("AF_INET");
    expect(decoded.socketType).toBe("SOCK_DGRAM");
    expect(/^127\.0\.0\.1:\d+$/.test(String(decoded.local))).toBe(true);
    expect(decoded.peer).toBe("127.0.0.1:9");
  });

  it("decodes an fd in a hook of a function the decoder calls itself, without calling the hook again", () => {
    const fd = track(socket(2, 2, 0));
    const getsockopt = libcFunction("getsockopt", "int", ["int", "int", "int", "pointer", "pointer"]);
    let calls = 0;
    let decoded: unknown;
    const listener = Interceptor.attach(Module.getGlobalExportByName("getsockopt"), {
      onEnter(args) {
        calls++;
        decoded = decodeFd(args[0].toInt32()).value;
      },
    });
    try {
      const value = Memory.alloc(4);
      const length = Memory.alloc(4);
      length.writeU32(4);
      getsockopt(fd, 1, 3, value, length);
    } finally {
      listener.detach();
    }

    expect(calls).toBe(1);
    expect((decoded as Record<string, unknown>).socketType).toBe("SOCK_DGRAM");
  });

  it("decodes an AF_UNIX socket in the abstract namespace, without a peer", () => {
    const fd = track(socket(1, 1, 0));
    const name = "frooky_fd_test";
    const address = Memory.alloc(110);
    address.writeU16(1);
    address.add(3).writeUtf8String(name);
    expect(bind(fd, address, 2 + 1 + name.length)).toBe(0);

    const decoded = decodeFd(fd).value as Record<string, unknown>;
    expect(decoded.family).toBe("AF_UNIX");
    expect(decoded.socketType).toBe("SOCK_STREAM");
    expect(decoded.local).toBe(`@${name}`);
    expect(decoded.peer).toBeNull();
  });
});

describe("formatSockaddr()", () => {
  it("formats an IPv4 address with its port", () => {
    expect(formatSockaddr(loopback(443), 16)).toBe("127.0.0.1:443");
  });

  it("formats an IPv6 address with its port", () => {
    const address = Memory.alloc(28);
    address.writeU16(10);
    address.add(2).writeByteArray([0x1f, 0x90]);
    address.add(8).writeByteArray([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(formatSockaddr(address, 28)).toBe("[2001:db8::1]:8080");
  });

  it("formats an AF_UNIX path", () => {
    const address = Memory.alloc(110);
    address.writeU16(1);
    address.add(2).writeUtf8String("/dev/socket/zygote");
    expect(formatSockaddr(address, 2 + "/dev/socket/zygote".length + 1)).toBe("/dev/socket/zygote");
  });

  it("reads the family of Darwin, a u8 after the length byte", () => {
    const ipv4 = Memory.alloc(16);
    ipv4.writeByteArray([16, 2, 0x01, 0xbb, 10, 0, 0, 1]);
    expect(formatSockaddr(ipv4, 16, "darwin")).toBe("10.0.0.1:443");

    const ipv6 = Memory.alloc(28);
    ipv6.writeByteArray([28, 30, 0x1f, 0x90]);
    ipv6.add(8).writeByteArray([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(formatSockaddr(ipv6, 28, "darwin")).toBe("[::1]:8080");

    const unix = Memory.alloc(106);
    unix.writeByteArray([106, 1]);
    unix.add(2).writeUtf8String("/var/run/syslog");
    expect(formatSockaddr(unix, 2 + "/var/run/syslog".length + 1, "darwin")).toBe("/var/run/syslog");
  });

  it("formats an unnamed AF_UNIX socket as null, and other families as their number", () => {
    const address = Memory.alloc(16);
    address.writeU16(1);
    expect(formatSockaddr(address, 2)).toBeNull();
    address.writeU16(16);
    expect(formatSockaddr(address, 12)).toBe(16);
  });
});

describe("formatIpv6()", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it("shortens the longest run of zero groups", () => {
    expect(formatIpv6(bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1))).toBe("::1");
    expect(formatIpv6(bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toBe("::");
    expect(formatIpv6(bytes(0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2))).toBe("fe80::1:0:0:2");
  });

  it("doesn't shorten a single zero group", () => {
    expect(formatIpv6(bytes(0, 1, 0, 0, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7))).toBe("1:0:2:3:4:5:6:7");
  });

  it("formats a mapped IPv4 address", () => {
    expect(formatIpv6(bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 10, 0, 2, 2))).toBe("::ffff:10.0.2.2");
  });
});
