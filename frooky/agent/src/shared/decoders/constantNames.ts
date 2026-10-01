// Names of the values of an integer, for the enum and flags decoders of both platforms.

// Constant names and values. A preset can also have an enum field inside the flags, e.g. the access mode
// `O_RDONLY`/`O_WRONLY`/`O_RDWR` in the lowest two bits of the `open` flags.
export type ConstantSet = {
  constants: Record<string, number>;
  enumMask?: number;
  enumConstants?: Record<string, number>;
};

// UInt64 has no toString(2), so the bits are counted per hex digit
const popcount = (n: UInt64): number =>
  Array.from(n.toString(16)).reduce((count, digit) => count + parseInt(digit, 16).toString(2).replace(/0/g, "").length, 0);

// The name of the constant with exactly this value, or the value itself if there is none.
export function decodeEnum(value: number | string, constants: Record<string, number>): string | number {
  for (const [name, constant] of Object.entries(constants)) {
    if (typeof value === "number" ? constant === value : String(constant) === value) return name;
  }
  return value;
}

// The names of the constants whose bits are all set, e.g. `["O_WRONLY", "O_CREAT"]`. Constants with more bits
// are matched first and use up their bits, so `O_SYNC` (which includes `O_DSYNC`) isn't also shown as `O_DSYNC`.
// Bits no constant matches are added as one hex string. A constant of 0 is only shown if no bit is set.
export function decodeFlags(bits: UInt64, set: ConstantSet): string[] {
  const names: string[] = [];
  let remaining = bits;
  if (set.enumMask !== undefined && set.enumConstants) {
    const mask = uint64(set.enumMask);
    const field = bits.and(mask).toNumber();
    const name = Object.entries(set.enumConstants).find(([, v]) => v === field)?.[0];
    if (name !== undefined) {
      names.push(name);
      remaining = remaining.and(mask.not());
    }
  }

  const candidates = Object.entries(set.constants)
    .filter(([, v]) => v > 0)
    .map(([name, v]) => ({ name, bits: uint64(v) }))
    .sort((a, b) => popcount(b.bits) - popcount(a.bits));
  const matched = new Set<string>();
  for (const { name, bits: flag } of candidates) {
    if (remaining.and(flag).equals(flag)) {
      matched.add(name);
      remaining = remaining.and(flag.not());
    }
  }
  // in the order the constants are declared, not the order they were matched in
  names.push(...Object.keys(set.constants).filter((name) => matched.has(name)));

  if (!remaining.equals(uint64(0))) {
    names.push(`0x${remaining.toString(16)}`);
  } else if (names.length === 0) {
    const zeroName = Object.entries(set.constants).find(([, v]) => v === 0)?.[0];
    if (zeroName !== undefined) names.push(zeroName);
  }
  return names;
}
