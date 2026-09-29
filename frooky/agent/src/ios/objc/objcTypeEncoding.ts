// Parser for Objective-C method type encodings from `method_getTypeEncoding()`, e.g. `@32@0:8@16q24`. Frida's
// `argumentTypes` turn every object into `pointer`, the encoding still tells objects, classes, selectors,
// C strings and plain pointers apart, which the decoders need.

const TYPE_QUALIFIERS = new Set(["r", "n", "N", "o", "O", "R", "V"]);

const CLOSING: Record<string, string> = { "{": "}", "(": ")", "[": "]" };

const PRIMITIVE_NAMES: Record<string, string> = {
  c: "char",
  i: "int",
  s: "short",
  l: "long",
  q: "long long",
  C: "unsigned char",
  I: "unsigned int",
  S: "unsigned short",
  L: "unsigned long",
  Q: "unsigned long long",
  f: "float",
  d: "double",
  B: "BOOL",
  v: "void",
  "*": "char*",
  "@": "id",
  "#": "Class",
  ":": "SEL",
};

export type ObjcMethodSignature = {
  // e.g. `id` or `void`
  returnType: string;
  // the explicit arguments, without `self` and `_cmd`
  argTypes: string[];
};

// reads one complete type at `pos` and returns it together with the position behind it
function readType(encoding: string, pos: number): [type: string, next: number] {
  while (pos < encoding.length && TYPE_QUALIFIERS.has(encoding[pos])) pos++;

  const typeStart = pos;
  const c = encoding[pos++];
  if (c === undefined) throw new Error(`Unexpected end of type encoding '${encoding}'.`);

  if (c === "@") {
    if (encoding[pos] === "?") {
      pos++; // block
    } else if (encoding[pos] === '"') {
      pos = encoding.indexOf('"', pos + 1) + 1; // @"ClassName"
      if (pos === 0) throw new Error(`Unterminated class name in type encoding '${encoding}'.`);
    }
  } else if (c === "^") {
    [, pos] = readType(encoding, pos); // pointee
  } else if (c in CLOSING) {
    const open = c;
    const close = CLOSING[c];
    let depth = 1;
    while (depth > 0) {
      if (pos >= encoding.length) throw new Error(`Unbalanced '${open}' in type encoding '${encoding}'.`);
      if (encoding[pos] === open) depth++;
      else if (encoding[pos] === close) depth--;
      pos++;
    }
  } else if (c === "b") {
    while (/\d/.test(encoding[pos] ?? "")) pos++; // bit field width
  }

  const type = encoding.slice(typeStart, pos);
  // skip the stack frame offset behind each type
  while (/\d/.test(encoding[pos] ?? "")) pos++;
  return [type, pos];
}

// One type encoding as the type name the Objective-C decoders use, e.g. `@` -> `id`, `q` -> `long long`,
// `@"NSString"` -> `NSString*`. Structs, unions and arrays are named after their kind, every pointer is `void*`.
export function objcTypeNameFromEncoding(encoding: string): string {
  const c = encoding[0];
  if (c === "@" && encoding[1] === "?") return "block";
  if (c === "@" && encoding[1] === '"') return encoding.slice(2, -1) + "*";
  if (c === "^") return "void*";
  if (c === "{") return "struct";
  if (c === "(") return "union";
  if (c === "[") return "array";
  if (c === "b") return "bitfield";
  return PRIMITIVE_NAMES[c] ?? "unknown";
}

// Parses a method type encoding, e.g. `v24@0:8@16`. Throws if it is malformed or lacks `self` and `_cmd`.
export function parseObjcMethodEncoding(encoding: string): ObjcMethodSignature {
  const types: string[] = [];
  let pos = 0;
  while (pos < encoding.length) {
    const [type, next] = readType(encoding, pos);
    types.push(type);
    pos = next;
  }
  if (types.length < 3) {
    throw new Error(`Type encoding '${encoding}' does not describe a method.`);
  }
  return {
    returnType: objcTypeNameFromEncoding(types[0]),
    argTypes: types.slice(3).map(objcTypeNameFromEncoding),
  };
}
