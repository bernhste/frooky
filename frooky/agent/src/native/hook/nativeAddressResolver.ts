import { NativeHookDeclaration } from "../../shared/hook/hookDeclaration";
import { describeNativeTarget } from "../../shared/inputParsing/inputNativeHookCollection";
import { logger } from "../../shared/logger";
import { NativeHook } from "./nativeHook";

// Looks up an exported symbol of a module
export type FindExport = (symbol: string) => NativePointer | undefined;

// The hooks of `inputHook` in `module`, or null if its symbol or offset doesn't resolve
export function resolveNativeHook(inputHook: NativeHookDeclaration, module: Module, findExport: FindExport): NativeHook[] | null {
  const target = describeNativeTarget(inputHook.module, inputHook);
  try {
    const symbolAddress =
      inputHook.symbol !== undefined ? resolveSymbol(inputHook.symbol, module, findExport) : resolveModuleOffset(inputHook.offset, module);
    logger.debug(`Address of function ${target} found: ${symbolAddress}.`);
    return [
      {
        module,
        moduleName: module.name,
        symbolName: inputHook.symbol,
        offset: inputHook.offset,
        symbolAddress,
        params: inputHook.params,
        retType: inputHook.retType,
        hookSettings: inputHook.hookSettings,
        decoderSettings: inputHook.decoderSettings,
      },
    ];
  } catch (e) {
    logger.warn(e instanceof Error ? e.message : String(e));
    return null;
  }
}

function resolveSymbol(symbol: string, module: Module, findExport: FindExport): NativePointer {
  const address = findExport(symbol);
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
