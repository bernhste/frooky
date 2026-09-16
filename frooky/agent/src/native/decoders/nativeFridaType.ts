export const FRIDA_FUNDAMENTAL_TYPES = [
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
    // `parseNativeFridaType` always lowercases its input before this table is consulted,
    // so alias keys must be lowercased too or they're unreachable (e.g. the literal
    // "_Bool" alias above would otherwise never match).
    (aliases as string[]).map((alias) => [alias.toLowerCase(), fridaType as FridaFundamentalType]),
  ),
);

/**
 * Constructs a {@link FridaReferenceType} representing a C/C++ pointer type from a
 * normalized type string (e.g. `"char*"`, `"unsigned char**"`).
 *
 * The base type (left of the first `*`) is resolved through
 * {@link FRIDA_FUNDAMENTAL_TYPE_ALIASES} to its canonical form. Unknown base types
 * (e.g. structs, `"FILE*"`) have no fundamental decoder to back them, so the whole
 * declaration is treated as unparseable and `undefined` is returned - the caller
 * falls back to decoding the pointer's raw address instead.
 *
 * @param normalizedType - A normalized pointer type string as produced by
 *   {@link parseNativeFridaType}'s own normalization, e.g. `"char*"` or `"unsigned char**"`.
 * @returns A {@link FridaReferenceType} with a resolved `pointee` and a `depth`
 *   equal to the number of indirection levels, or `undefined` if the base type
 *   isn't a known fundamental type.
 *
 * @example
 * createPointerType("char*")
 *   => { pointee: "char", depth: 1 }
 *
 * createPointerType("unsigned char**")
 *   => { pointee: "uchar", depth: 2 }
 *
 * createPointerType("somestruct*")
 *   => undefined
 */
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

/**
 * normalizes the input string from the frooky config to the canonical Frida type
 * which are mapped to the types listed in {@link https://frida.re/docs/javascript-api/#nativefunction}
 *
 * @example
 * parseNativeFridaType("char ")
 *   => "char"
 *
 * parseNativeFridaType("const char ")
 *   => "char"
 *
 * parseNativeFridaType(" long long int ")
 *   => "int64"
 *
 * parseNativeFridaType("_Bool")
 *   => "bool"
 *
 * parseNativeFridaType("boolean")
 *   => "bool"
 *
 * parseNativeFridaType(" char ** ")
 *   => { pointee: "char", depth: 2 }
 *
 */
export function parseNativeFridaType(type: string): FridaFundamentalType | FridaReferenceType | undefined {
  // basic normalization: strip `const`/`volatile` qualifiers wherever they appear
  // (leading, trailing, or between indirection levels - e.g. "char* const") and
  // collapse whitespace around `*` so pointer depth can be counted reliably.
  const normalized = type
    .trim()
    .toLowerCase()
    .replace(/\b(const|volatile)\b\s*/g, "")
    .replace(/\s*\*\s*/g, "*")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.endsWith("*")) {
    // type pointer
    return createPointerType(normalized);
  }
  // type fundamental
  return FRIDA_FUNDAMENTAL_TYPE_ALIASES[normalized];
}

export type FridaFundamentalType = (typeof FRIDA_FUNDAMENTAL_TYPES)[number];

export type FridaReferenceType = { pointee: FridaFundamentalType; depth: number };
