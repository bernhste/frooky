import { NativeHookDeclaration, NativeSymbolHookDeclaration } from "../../shared/hook/hookDeclaration";
import { describeNativeTarget } from "../../shared/inputParsing/inputNativeHookCollection";
import { logger } from "../../shared/logger";
import { namePatternToRegExp, plural } from "../../shared/utils";
import { NativeHook } from "./nativeHook";
import { applyBlockedFunctions, warnOnHighFrequencyLibcHook } from "./nativeHookValidator";

// The exports of a module: `find` looks up one symbol, `functions` lists the exported functions
export type ModuleExports = {
  find: (symbol: string) => NativePointer | undefined;
  functions: () => ModuleExportDetails[];
};

// Reads the export table at most once. `findByName`: look up single symbols with findExportByName(), only for a
// module that has loaded: while the linker loads it, findExportByName() makes the linker abort the process.
export function moduleExports(module: Module, findByName: boolean): ModuleExports {
  let exports: ModuleExportDetails[] | undefined;
  let addresses: Map<string, NativePointer> | undefined;
  const all = () => (exports ??= module.enumerateExports());
  return {
    find: findByName
      ? (symbol) => module.findExportByName(symbol) ?? undefined
      : (symbol) => (addresses ??= new Map(all().map((e) => [e.name, e.address]))).get(symbol),
    functions: () => all().filter((e) => e.type === "function"),
  };
}

// The hooks of `inputHook` in `module`, or null if its symbol or offset doesn't resolve. A `*` in the symbol matches
// any characters of the exported functions' names.
export function resolveNativeHook(inputHook: NativeHookDeclaration, module: Module, exports: ModuleExports): NativeHook[] | null {
  const target = describeNativeTarget(inputHook.module, inputHook);
  try {
    if (inputHook.symbol?.includes("*")) return resolveSymbolPattern(inputHook, module, exports);
    const symbolAddress =
      inputHook.symbol !== undefined ? resolveSymbol(inputHook.symbol, module, exports) : resolveModuleOffset(inputHook.offset, module);
    logger.debug(`Address of function ${target} found: ${symbolAddress}.`);
    return [toNativeHook(inputHook, module, symbolAddress)];
  } catch (e) {
    logger.warn(e instanceof Error ? e.message : String(e));
    return null;
  }
}

function toNativeHook(inputHook: NativeHookDeclaration, module: Module, symbolAddress: NativePointer): NativeHook {
  return {
    module,
    moduleName: module.name,
    symbolName: inputHook.symbol,
    offset: inputHook.offset,
    symbolAddress,
    params: inputHook.params,
    retType: inputHook.retType,
    hookSettings: inputHook.hookSettings,
    decoderSettings: inputHook.decoderSettings,
  };
}

// One hook per matching function, without blocked functions. Of several names of one function (e.g. memcpy and
// memmove in some libcs), only the first, so a call is recorded once.
function resolveSymbolPattern(inputHook: NativeSymbolHookDeclaration, module: Module, exports: ModuleExports): NativeHook[] {
  const pattern = inputHook.symbol;
  const regExp = namePatternToRegExp(pattern);
  const addresses = new Set<string>();
  const hooks: NativeHook[] = [];
  for (const { name, address } of exports.functions()) {
    if (!regExp.test(name) || addresses.has(address.toString())) continue;
    const hook = applyBlockedFunctions({ ...inputHook, symbol: name });
    if (!hook) continue;
    addresses.add(address.toString());
    warnOnHighFrequencyLibcHook(hook);
    hooks.push(toNativeHook(hook, module, address));
  }
  if (hooks.length === 0) throw Error(`Skipping hook for '${pattern}'. No exported function of module '${module.name}' matches it.`);
  logger.debug(`${plural(hooks.length, "function")} of module '${module.name}' match '${pattern}'.`);
  return hooks;
}

function resolveSymbol(symbol: string, module: Module, exports: ModuleExports): NativePointer {
  const address = exports.find(symbol);
  if (!address) throw Error(`Skipping hook for '${symbol}'. This symbol does not exist in module '${module.name}'.`);
  return address;
}

// `module.base + offset`. Throws unless the address is inside the module and in a code section: patching
// data, e.g. with an offset from another build of the library, crashes the app.
function resolveModuleOffset(offset: string, module: Module): NativePointer {
  const target = `${module.name}+${offset}`;
  const moduleOffset = ptr(offset);
  if (moduleOffset.compare(ptr(module.size)) >= 0) {
    throw Error(`Skipping hook for '${target}'. The offset is outside the module, which is only 0x${module.size.toString(16)} bytes large.`);
  }
  const address = module.base.add(offset);
  const range = Process.findRangeByAddress(address);
  if (!range || !range.protection.includes("x")) {
    throw Error(
      `Skipping hook for '${target}'. The address ${address} is not executable (${range ? range.protection : "unmapped"}); check that the offset is a function's virtual address minus the image base, not a file offset.`,
    );
  }
  // small libraries often map .rodata, .dynsym etc. into the executable segment of .text
  const section = module.enumerateSections().find((s) => address.compare(s.address) >= 0 && address.compare(s.address.add(s.size)) < 0);
  if (section && !/^\.(text|plt|init|fini)/.test(section.name)) {
    throw Error(
      `Skipping hook for '${target}'. The offset points into the section '${section.name}', which holds data, not code; check that the offset is the function's address in this exact build and ABI of the library (e.g. from 'nm -D --defined-only ${module.name}').`,
    );
  }
  return address;
}
