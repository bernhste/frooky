const SIGN_BIT_64 = uint64("0x8000000000000000");
const LOW_63_BITS = int64("0x7fffffffffffffff");

// The bits of a Java integer (`byte`, `short`, `char`, `int`, `long`) as unsigned, e.g. -1 as an `int` is
// 0xffffffff. Frida passes a `char` as a string of one character and a `long` as an Int64 or a number. Undefined for
// other values.
export function javaBits(value: unknown, type: string): UInt64 | undefined {
  if (type === "char" && typeof value === "string" && value.length === 1) return uint64(value.charCodeAt(0));
  const n = Number(String(value));
  if (!Number.isInteger(n)) return undefined;
  switch (type) {
    case "byte":
      return uint64(n & 0xff);
    case "short":
    case "char":
      return uint64(n & 0xffff);
    case "long": {
      // a long beyond 2^53 is passed as an Int64 or a string; Int64 keeps all 64 bits
      const long = int64(String(value));
      const low = uint64(long.and(LOW_63_BITS).toString());
      return long.compare(0) < 0 ? low.add(SIGN_BIT_64) : low;
    }
    default:
      return uint64(n >>> 0);
  }
}

// The IEEE 754 bits of a Java `float` or `double`, e.g. 1.5 as a `float` is 0x3fc00000. Undefined for other values.
export function javaFloatBits(value: unknown, type: string): UInt64 | undefined {
  if (typeof value !== "number") return undefined;
  const view = new DataView(new ArrayBuffer(8));
  if (type === "float") {
    view.setFloat32(0, value);
    return uint64(view.getUint32(0));
  }
  if (type === "double") {
    view.setFloat64(0, value);
    return uint64(view.getBigUint64(0).toString());
  }
  return undefined;
}
