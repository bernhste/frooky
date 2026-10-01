import { DecoderArgs } from "../frookySettings";

export type DecoderArgRole = keyof DecoderArgs;

export const DECODER_ARG_ROLES: readonly DecoderArgRole[] = ["length", "offset"];

// The `decoderArgs` value that passes the return value, e.g. the number of bytes `read` wrote into its buffer.
export const RETURN_VALUE_DECODER_ARG = "$ret";

// The values of the roles when a value is decoded: the decoded value of another parameter, the decoded return
// value, or the number from the hook file
export type DecoderArgValues = Partial<Record<DecoderArgRole, unknown>>;

// The value of a role as a count, e.g. a length or an offset. Undefined if the role isn't set. A 64-bit value is a
// decimal string (see NativeValueDecoder). Throws if the value is no non-negative integer, e.g. -1 when read fails.
export function countArg(args: DecoderArgValues | undefined, role: DecoderArgRole): number | undefined {
  if (!args || !(role in args)) return undefined;
  const value = args[role];
  const count = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(count) || count < 0) {
    throw Error(`decoderArgs '${role}' must be a non-negative integer, but it is: ${JSON.stringify(value)}`);
  }
  return count;
}

// The elements `[start, end)` of an array of `total` elements that the roles `offset` and `length` select, cut to
// the array: without `offset` from the start, without `length` to the end.
export function sliceBounds(args: DecoderArgValues | undefined, total: number): { start: number; end: number } {
  const start = Math.min(countArg(args, "offset") ?? 0, total);
  const length = countArg(args, "length");
  return { start, end: length === undefined ? total : Math.min(start + length, total) };
}
