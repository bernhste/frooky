import { DEFAULT_BASE_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { NativeHook } from "./nativeHook";
import { NativeHookIndex } from "./nativeHookIndex";

const libc = Process.getModuleByName("libc.so");

function libcHook(symbol: string): NativeHook {
  return {
    module: libc,
    moduleName: libc.name,
    symbolName: symbol,
    symbolAddress: libc.getExportByName(symbol),
    hookSettings: DEFAULT_HOOK_SETTINGS,
    decoderSettings: DEFAULT_BASE_DECODER_SETTINGS,
  };
}

describe("NativeHookIndex", () => {
  it("knows the modules of the added hooks", () => {
    const index = new NativeHookIndex();
    const notInAnyModule = Memory.alloc(8);
    expect(index.isInHookedModule(libc.base)).toBe(false);

    index.add(libcHook("malloc"));

    expect(index.isInHookedModule(libc.base)).toBe(true);
    expect(index.isInHookedModule(libc.base.add(libc.size))).toBe(false);
    expect(index.isInHookedModule(notInAnyModule)).toBe(false);
  });

  it("describes the hooks in the modules of the addresses", () => {
    const index = new NativeHookIndex();
    index.add(libcHook("malloc"));
    index.add(libcHook("free"));

    expect(index.describeHooksInModulesOf([libc.base])).toEqual(["libc.so!malloc", "libc.so!free"]);
    expect(index.describeHooksInModulesOf([Memory.alloc(8)])).toEqual([]);
  });

  it("finds the hooked function at an address in its patched bytes", () => {
    const index = new NativeHookIndex();
    const malloc = libcHook("malloc");
    index.add(malloc);

    expect(index.describeHookedFunctionAt(malloc.symbolAddress.add(4))).toBe("libc.so!malloc");
    expect(index.describeHookedFunctionAt(libc.getExportByName("free"))).toBeUndefined();
  });

  it("forgets deleted hooks", () => {
    const index = new NativeHookIndex();
    const malloc = libcHook("malloc");
    index.add(malloc);

    index.delete(malloc);

    expect(index.has(malloc)).toBe(false);
    expect(index.isInHookedModule(libc.base)).toBe(false);
  });
});
