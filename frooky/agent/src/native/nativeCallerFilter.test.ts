import { NativeCallerFilter } from "./nativeCallerFilter";

describe("NativeCallerFilter", () => {
  const libc = Process.getModuleByName("libc.so");
  const libm = Process.getModuleByName("libm.so");

  it("matches addresses inside the modules whose name matches", () => {
    const filter = new NativeCallerFilter(["^libc\\.so$"], "test");
    try {
      expect(filter.matches(libc.base)).toBe(true);
      expect(filter.matches(libc.base.add(libc.size - 1))).toBe(true);
      expect(filter.matches(libc.base.add(libc.size))).toBe(false);
      expect(filter.matches(libm.base)).toBe(false);
    } finally {
      filter.dispose();
    }
  });

  it("describes the matching modules", () => {
    const filter = new NativeCallerFilter(["^libc\\.so$"], "libc.so!malloc");
    const none = new NativeCallerFilter(["^never\\.so$"], "libc.so!free");
    try {
      expect(filter.describe()).toBe("Caller filter on libc.so!malloc: records calls from libc.so");
      expect(none.describe()).toContain("no loaded module matches ^never\\.so$");
    } finally {
      filter.dispose();
      none.dispose();
    }
  });

  it("matches nothing without a matching module, and after dispose()", () => {
    const none = new NativeCallerFilter(["^never\\.so$"], "test");
    const disposed = new NativeCallerFilter(["^lib[cm]\\.so$"], "test");
    expect(disposed.matches(libm.base)).toBe(true);
    disposed.dispose();
    try {
      expect(none.matches(libc.base)).toBe(false);
      expect(disposed.matches(libm.base)).toBe(false);
    } finally {
      none.dispose();
    }
  });
});

export {};
