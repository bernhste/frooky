// A decoded length argument is a number, or a decimal string for 64-bit types (see NativeValueDecoder).
export const parseLengthArgValue = (value: unknown): number | undefined => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return undefined;
};
