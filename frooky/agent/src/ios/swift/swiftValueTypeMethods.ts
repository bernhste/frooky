import type { Enum, Struct } from "frida-swift-bridge/dist/lib/types.js";
import { tryDemangleSymbol } from "frida-swift-bridge/dist/lib/symbols.js";

export type SwiftMethodDetails = { name: string; address: NativePointer };

// enumerating the symbols of a module is expensive, so it is done once per module
const moduleSymbolsCache = new Map<string, ModuleSymbolDetails[]>();

function getModuleSymbols(module: Module): ModuleSymbolDetails[] {
  let symbols = moduleSymbolsCache.get(module.path);
  if (!symbols) {
    symbols = module.enumerateSymbols();
    moduleSymbolsCache.set(module.path, symbols);
  }
  return symbols;
}

// The methods of a struct or enum, named by their demangled symbol like the bridge's class methods. The bridge
// only lists class methods (from the vtable), struct and enum methods are dispatched statically, so they are
// found by their symbols: every symbol of the type's binary that demangles to `Module.Type.method(...) -> ...`.
// This needs the symbols not to be stripped.
export function findValueTypeMethods(type: Struct | Enum): SwiftMethodDetails[] {
  const module = Process.findModuleByAddress(type.descriptor.handle);
  if (!module) return [];

  // in a mangled symbol, an identifier is prefixed with its length. Cheap check to avoid demangling every symbol.
  const mangledIdentifier = `${type.$name.length}${type.$name}`;
  const prefix = `${type.$moduleName}.${type.$name}.`;
  // directly followed by the method name and its arguments, this excludes nested types and accessors
  const methodStart = /^[A-Za-z_]\w*(<.*>)?\(/;

  const methods = new Map<string, SwiftMethodDetails>();
  for (const symbol of getModuleSymbols(module)) {
    if (!symbol.name.includes(mangledIdentifier)) continue;

    const demangled = tryDemangleSymbol(symbol.name)?.replace(/^static /, "");
    if (!demangled?.startsWith(prefix) || !methodStart.test(demangled.slice(prefix.length))) continue;

    // the same implementation can be listed with more than one symbol
    methods.set(symbol.address.toString(), { name: demangled, address: symbol.address });
  }
  return [...methods.values()];
}
