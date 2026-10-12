import { Direction } from "../decoders/decodable";
import { DecoderArgValue, DecoderOptions, FilterPattern, HookSettings, BaseDecoderSettings } from "../frookySettings";

/**
 * Hook settings in a hook file. Every field is optional; missing fields are inherited.
 *
 * @public
 */
export type InputHookSettings = Partial<HookSettings>;

/**
 * Decoder settings of the file, a hook collection or a hook. Every field is optional; missing fields are inherited.
 *
 * @public
 */
export type InputDecoderSettings = Partial<BaseDecoderSettings>;

/**
 * Decoder settings of a return value. Every field is optional; missing fields are inherited.
 *
 * @public
 */
export interface InputReturnSettings extends InputDecoderSettings {
  /**
   * Options of the decoder selected with `decoder:`, e.g. `{ constants: { O_CREAT: 0x40 } }`. Each decoder accepts some
   * options; any other option makes the hook invalid.
   */
  decoderOptions?: DecoderOptions;
}

/**
 * Settings of a single parameter. Every field is optional; missing fields are inherited.
 *
 * @public
 */
export interface InputParamSettings extends InputReturnSettings {
  /** When the parameter is decoded. Default: `"in"`. */
  direction?: Direction;

  /**
   * How many elements to decode, e.g. the number of bytes of a buffer or of elements of an array: the name of another
   * parameter, `$ret` for the return value (only with `direction: out`), or a number. A decoder that doesn't accept a
   * length makes the hook invalid.
   */
  length?: DecoderArgValue;

  /**
   * How many elements to skip before decoding, e.g. where a slice starts in a Java `byte[]`: the name of another
   * parameter, `$ret` for the return value (only with `direction: out`), or a number. A decoder that doesn't accept an
   * offset makes the hook invalid.
   */
  offset?: DecoderArgValue;

  /**
   * Filter patterns matched against the decoded value: numeric comparisons (`> 100`, `>= 0`, `< 10`, `<= 50`, `== 42`,
   * `!= -1`) against numbers, or regular expressions against strings and numbers. The event is only captured if at least
   * one matches. Lists, booleans and `null` always pass.
   */
  argFilter?: FilterPattern[];
}
