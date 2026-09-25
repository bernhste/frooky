/**
 * Metadata that describes a hook collection.
 *
 * @public
 */
export interface HookSettings {
  /**
   * Sets stackTraceLimit to the given value for all hooks.
   */
  stackTraceLimit: number;

  /**
   * Stack trace filters to apply.
   */
  stackTraceFilter: string[];
}

/**
 * Decoder settings any kind of parameter or return type decoder
 *
 * @public
 */
export interface DecoderSettings {
  /**
   * Maximum recursion depth for nested structure decoding.
   *
   * @example 10
   */
  maxDepth: number;

  /**
   * Maximum number of elements to decode in lists, arrays, collections, maps etc.. May be increased when decoding 'char *' or 'void *' data types in native code.
   *
   * @example 1000
   */
  maxItems: number;

  /**
   * When enabled, the decoders are instructed to prioritize speed over details. Mostly, this mean avoiding expensive Frida <-> native roundtrip.
   *
   * @defaultValue false
   */
  fastDecode: boolean;

  /**
   * When enabled, hooks compute and report an identifier for "which instance/target this call belongs
   * to", to let callers correlate events. For java hooks this is `Object.hashCode()` of the instance
   * (a Frida <-> Java bridge round-trip on every call); for native hooks this is the hooked function's
   * address, which is already available at no extra cost. Off by default for parity with the java cost.
   *
   * @defaultValue false
   */
  hashCode: boolean;

  /**
   * Overrides the type decoder.
   *
   * @defaultValue undefined
   */
  decoder?: string;

  /**
   * Arguments form the arguments list passed to the decoder.
   *
   * @defaultValue undefined
   */
  decoderArg?: string;

  /**
   * Regular expressions for how an argument is filtered
   *
   * @defaultValue undefined
   */
  paramFilter?: string[];
}

export interface FrookySettings {
  hookSettings: HookSettings;
  decoderSettings: DecoderSettings;
}
