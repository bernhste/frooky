import { Direction } from "../decoders/decodable";
import { DecoderSettings, HookSettings, BaseDecoderSettings } from "../frookySettings";

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
 * Decoder settings of the file, a hook collection or a hook. Every field is optional; missing fields are inherited.
 *
 * @public
 */
export type InputDecoderSettings = Partial<BaseDecoderSettings>;

/**
 * Decoder settings of a single parameter or return value. Every field is optional; missing fields are inherited.
 *
 * @public
 */
export type InputValueDecoderSettings = Partial<DecoderSettings>;

/**
 * Inline settings of a single parameter.
 *
 * @public
 */
export type InputParamSettings = InputValueDecoderSettings & {
  /** When the parameter is decoded. Default: `"in"`. */
  direction?: Direction;
};
