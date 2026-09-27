import { Direction } from "../decoders/decodable";
import { DecoderSettings, HookSettings } from "../frookySettings";

/**
 * Top-level settings of a hook file.
 *
 * @public
 */
export type InputFrookySettings = {
  /** Default hook settings for all hooks. */
  hookSettings?: InputHookSettings;

  /** Default decoder settings for all parameters and return values. */
  decoderSettings?: InputDecoderSettings;
};

/**
 * Hook settings in a hook file. Every field is optional; missing fields are inherited.
 *
 * @public
 */
export type InputHookSettings = Partial<HookSettings>;

/**
 * Decoder settings in a hook file. Every field is optional; missing fields are inherited.
 *
 * @public
 */
export type InputDecoderSettings = Partial<DecoderSettings>;

/**
 * Inline settings of a single parameter.
 *
 * @public
 */
export type InputParamSettings = Partial<DecoderSettings> & {
  /** When the parameter is decoded. Default: `"in"`. */
  direction?: Direction;
};
