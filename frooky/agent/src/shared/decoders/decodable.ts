import { DecoderSettings } from "../frookySettings";

/**
 * A typed value that can be decoded.
 *
 * @public
 */
export interface Decodable {
  /** Declared type, e.g. `int`, `java.lang.String`, `[B` or `char *`. */
  type: string;

  /** Name shown for the value in events. */
  name?: string;

  /** Java class that declares the hooked method. Set by frooky; not needed in hook files. */
  declaringClass?: string;

  /** Decoder settings for this value. */
  settings: DecoderSettings;
}

/**
 * When a parameter is decoded: on entry (`"in"`), on return (`"out"`), or both (`"inout"`).
 *
 * @public
 */
export type Direction = "in" | "out" | "inout";

/**
 * A parameter of a function or method.
 *
 * @public
 */
export interface Param extends Decodable {
  /**
   * When the parameter is decoded. Default: `"in"`.
   */
  direction: Direction;
}

/**
 * The return value of a function or method.
 *
 * @public
 */
export interface RetType extends Decodable {}
