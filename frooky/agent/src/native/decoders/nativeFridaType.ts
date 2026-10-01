const FRIDA_FUNDAMENTAL_TYPES = [
  "void",
  "bool",
  "char",
  "uchar",
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int",
  "uint",
  "int64",
  "uint64",
  "long",
  "ulong",
  "size_t",
  "ssize_t",
  "float",
  "double",
] as const;

const FRIDA_FUNDAMENTAL_TYPE_ALIASES: Record<string, FridaFundamentalType> = Object.fromEntries(
  [
    ["void", ["void"]],
    ["bool", ["bool", "_Bool", "boolean"]],
    ["char", ["char", "schar", "signed char"]],
    ["uchar", ["uchar", "unsigned char"]],
    ["int8", ["int8", "int8_t"]],
    ["uint8", ["uint8", "uint8_t"]],
    ["int16", ["int16", "int16_t", "short", "signed short", "short int", "signed short int"]],
    ["uint16", ["uint16", "uint16_t", "ushort", "unsigned short", "unsigned short int"]],
    ["int32", ["int32", "int32_t"]],
    ["uint32", ["uint32", "uint32_t"]],
    ["int", ["int", "signed", "signed int"]],
    ["uint", ["uint", "unsigned", "unsigned int"]],
    ["int64", ["int64", "int64_t", "long long", "signed long long", "long long int", "llong"]],
    ["uint64", ["uint64", "uint64_t", "unsigned long long", "unsigned long long int", "ullong"]],
    ["long", ["long", "signed long", "long int", "intptr_t", "ptrdiff_t", "off_t", "time_t"]],
    ["ulong", ["ulong", "unsigned long", "unsigned long int", "uintptr_t"]],
    ["size_t", ["size_t"]],
    ["ssize_t", ["ssize_t"]],
    ["float", ["float"]],
    ["double", ["double"]],
  ].flatMap(([fridaType, aliases]) =>
    // parseNativeFridaType() lowercases its input
    (aliases as string[]).map((alias) => [alias.toLowerCase(), fridaType as FridaFundamentalType]),
  ),
);

// Normalized pointer type to its pointee and depth, undefined if the pointee is no fundamental type:
// "char*" -> { pointee: "char", depth: 1 }, "unsigned char**" -> { pointee: "uchar", depth: 2 }, "FILE*" -> undefined
function createPointerType(normalizedType: string): FridaReferenceType | undefined {
  const starIndex = normalizedType.indexOf("*");
  const baseType = normalizedType.slice(0, starIndex).trim();
  const depth = normalizedType.length - starIndex;

  const pointee = FRIDA_FUNDAMENTAL_TYPE_ALIASES[baseType];
  if (!pointee) {
    return undefined;
  }

  return { pointee, depth };
}

// Declared C type to a Frida type (https://frida.re/docs/javascript-api/#nativefunction), undefined if unknown:
// "const char" -> "char", "long long int" -> "int64", "_Bool" -> "bool", " char ** " -> { pointee: "char", depth: 2 }
export function parseNativeFridaType(type: string): FridaFundamentalType | FridaReferenceType | undefined {
  // drop `const`/`volatile` anywhere (e.g. "char* const") and the whitespace around `*`
  const normalized = type
    .trim()
    .toLowerCase()
    .replace(/\b(const|volatile)\b\s*/g, "")
    // an array parameter is a pointer, e.g. `char *[]` is `char **`
    .replace(/\s*\[\s*\d*\s*\]/g, "*")
    .replace(/\s*\*\s*/g, "*")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.endsWith("*")) {
    return createPointerType(normalized);
  }
  return FRIDA_FUNDAMENTAL_TYPE_ALIASES[normalized];
}

export type FridaFundamentalType = (typeof FRIDA_FUNDAMENTAL_TYPES)[number];

export type FridaReferenceType = { pointee: FridaFundamentalType; depth: number };
