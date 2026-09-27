/**
 * Settings that control how a hook captures events.
 *
 * @public
 */
export interface HookSettings {
  /**
   * Maximum number of stack frames captured per event. `0` captures none. Default: `0`.
   *
   * @minimum 0
   */
  stackTraceLimit: number;

  /**
   * Regular expressions matched against stack frames. The event is only captured if at least one frame matches. Default: `[]`.
   */
  stackTraceFilter: string[];
}

/**
 * Settings that control how parameter and return values are decoded.
 *
 * @public
 */
export interface DecoderSettings {
  /**
   * Maximum number of nested levels decoded. Default: `10`.
   *
   * @minimum 1
   */
  maxDepth: number;

  /**
   * Maximum number of elements decoded per array, list or map, or bytes per native buffer. Default: `100`.
   *
   * @minimum 1
   */
  maxItems: number;

  /**
   * Adds an identifier to each event: `Object.hashCode()` of the instance for Java hooks, the function's
   * address for native hooks. Default: `false`.
   */
  hashCode: boolean;

  /**
   * Name of the decoder to use instead of the one chosen from the declared type.
   */
  decoder?: string;

  /**
   * Name of function/method parameter whose value is passed to this decoder, e.g. a buffer length.
   */
  decoderArg?: string;

  /**
   * Regular expressions matched against the decoded value. The event is only captured if at least one
   * matches. Only string and number values are filtered; other values always pass.
   */
  argFilter?: string[];
}

export interface FrookySettings {
  hookSettings: HookSettings;
  decoderSettings: DecoderSettings;
}
