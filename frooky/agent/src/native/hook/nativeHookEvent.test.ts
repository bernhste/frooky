import { addressHashCode } from "./nativeHookEvent";

describe("addressHashCode()", () => {
  it("XORs the upper and lower 32 bits, like Java's Long.hashCode()", () => {
    expect(addressHashCode(ptr("0x7b3c2a1f40"))).toBe("3c2a1f3b");
    expect(addressHashCode(ptr("0x100000002"))).toBe("3");
    expect(addressHashCode(ptr("0x1234"))).toBe("1234");
  });

  it("handles addresses with the top bit set", () => {
    expect(addressHashCode(ptr("0xffffffff00000000"))).toBe("ffffffff");
    expect(addressHashCode(ptr("0xffffffffffffffff"))).toBe("0");
  });
});

export {};
