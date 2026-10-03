import { CrashHookLookup } from "../../shared/crashReporter";
import { describeNativeTarget } from "../../shared/inputParsing/inputNativeHookCollection";
import { INTERCEPTOR_PATCH_BYTES, NativeHook } from "./nativeHook";

function inModule(address: NativePointer, module: Module): boolean {
  return address.compare(module.base) >= 0 && address.compare(module.base.add(module.size)) < 0;
}

// e.g. `libfoo.so!open` or `libfoo.so+0x1a2b4`
function describe(hook: NativeHook): string {
  return describeNativeTarget(hook.moduleName, { symbol: hook.symbolName, offset: hook.offset });
}

// The installed native hooks, for the crash reporter's questions about addresses
export class NativeHookIndex implements CrashHookLookup {
  private readonly hooks = new Set<NativeHook>();

  has(hook: NativeHook): boolean {
    return this.hooks.has(hook);
  }

  add(hook: NativeHook): void {
    this.hooks.add(hook);
  }

  delete(hook: NativeHook): void {
    this.hooks.delete(hook);
  }

  // Whether `address` is in a module with an installed hook. Called for every native exception, see
  // installCrashReporter(), so it only compares addresses.
  isInHookedModule(address: NativePointer): boolean {
    for (const hook of this.hooks) {
      if (inModule(address, hook.module)) return true;
    }
    return false;
  }

  // The installed hooks (e.g. `libfoo.so+0x1a2b4`) in the modules that contain any of `addresses`.
  describeHooksInModulesOf(addresses: NativePointer[]): string[] {
    return [...this.hooks].filter((hook) => addresses.some((address) => inModule(address, hook.module))).map(describe);
  }

  // The installed hook whose function contains `address`: `address` is in the bytes the Interceptor patched, or
  // has the same symbol as the hook (e.g. `receive_utf8+0x3` and `receive_utf8`).
  describeHookedFunctionAt(address: NativePointer): string | undefined {
    const functionName = (symbol: DebugSymbol) =>
      symbol.name === null || symbol.name.startsWith("0x") ? null : symbol.name.replace(/\+0x[0-9a-f]+$/, "");
    const symbol = DebugSymbol.fromAddress(address);
    const name = functionName(symbol);
    const hook = [...this.hooks].find(
      (hook) =>
        (address.compare(hook.symbolAddress) >= 0 && address.compare(hook.symbolAddress.add(INTERCEPTOR_PATCH_BYTES)) < 0) ||
        (name !== null && symbol.moduleName === hook.moduleName && functionName(DebugSymbol.fromAddress(hook.symbolAddress)) === name),
    );
    return hook ? describe(hook) : undefined;
  }
}
