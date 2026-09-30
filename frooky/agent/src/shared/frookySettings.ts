/**
 * Settings that control how a hook captures events.
 *
 * @public
 */
export interface HookSettings {
  /**
   * Maximum number of stack frames captured per event. Default: `10`.
   *
   * @minimum 0
   */
  maxStackFrames: number;

  /**
   * Regular expressions matched against stack frames. The event is only captured if at least one frame matches. Default: `[]`.
   */
  stackTraceFilter: string[];

  /**
   * Whether to capture native (C/C++) stack frames. Default: `false`.
   */
  nativeStackTrace: boolean;

  /**
   * Whether to capture platform (managed runtime, e.g. Java) stack frames. Default: `false`.
   */
  platformStackTrace: boolean;
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
   * Maximum number of elements decoded per array, list or map, bytes per buffer, or characters per Java string (also for
   * each string in a list or map). Default: `100`.
   *
   * @minimum 1
   */
  maxItems: number;

  /**
   * Adds a `hashCode` to each event, as 32-bit hex: `Object.hashCode()` of the instance for Java hooks (none for
   * static methods), a hash of the function's address for native hooks. Default: `false`.
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
