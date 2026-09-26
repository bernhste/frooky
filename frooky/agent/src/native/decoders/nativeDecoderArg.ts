// A length argument is usually declared as `int`/`size_t`/etc. On LP64 targets
// NativeValueDecoder returns size_t/long/ssize_t/ulong/int64/uint64 as decimal
// strings (to preserve full 64-bit precision), so a decoded length arg may
// legitimately be a numeric string rather than a `number` - accept both.
export const parseLengthArgValue = (value: unknown): number | undefined => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return undefined;
};
