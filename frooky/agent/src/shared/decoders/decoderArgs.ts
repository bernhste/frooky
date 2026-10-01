import { DecoderArgs } from "../frookySettings";
import { logger } from "../logger";

export type DecoderArgRole = keyof DecoderArgs;

export const DECODER_ARG_ROLES: readonly DecoderArgRole[] = ["length", "offset"];

// The `decoderArgs` value that passes the return value, e.g. the number of bytes `read` wrote into its buffer.
export const RETURN_VALUE_DECODER_ARG = "$ret";

// The values of the roles when a value is decoded: the decoded value of another parameter, the decoded return
// value, or the number from the hook file
export type DecoderArgValues = Partial<Record<DecoderArgRole, unknown>>;

// Thrown by countArg() for a negative count, e.g. the -1 that `read` returns on an error. It's a result of the call,
// not a mistake in the hook file, so the parameter decodes as null without a warning, see logDecodeFailure().
export class NegativeCountError extends Error {}

// The value of a role as a count, e.g. a length or an offset. Undefined if the role isn't set. A 64-bit value is a
// decimal string (see NativeValueDecoder). Throws NegativeCountError for a negative integer, an Error for no integer.
export function countArg(args: DecoderArgValues | undefined, role: DecoderArgRole): number | undefined {
  if (!args || !(role in args)) return undefined;
  const value = args[role];
  const count = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(count)) {
    throw Error(`decoderArgs '${role}' must be a non-negative integer, but it is: ${JSON.stringify(value)}`);
  }
  if (count < 0) {
    throw new NegativeCountError(`decoderArgs '${role}' is negative: ${JSON.stringify(value)}`);
  }
  return count;
}

// Logs why a value decodes as null: at debug level for a NegativeCountError, otherwise as a warning
export function logDecodeFailure(message: string, error: unknown): void {
  if (error instanceof NegativeCountError) {
    logger.debug(`${message}: ${error}`);
  } else {
    logger.warn(`${message}: ${error}`);
  }
}

// The elements `[start, end)` of an array of `total` elements that the roles `offset` and `length` select, cut to
// the array: without `offset` from the start, without `length` to the end.
export function sliceBounds(args: DecoderArgValues | undefined, total: number): { start: number; end: number } {
  const start = Math.min(countArg(args, "offset") ?? 0, total);
  const length = countArg(args, "length");
  return { start, end: length === undefined ? total : Math.min(start + length, total) };
}
