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
   * Name of the decoder to use instead of the one chosen from the declared type.
   */
  decoder?: string;

  /**
   * Values the decoder needs to decode the parameter, by their role, e.g. `{ length: len }` for a buffer whose length is
   * in the parameter `len`. Each decoder accepts some roles; any other role makes the hook invalid.
   */
  decoderArgs?: DecoderArgs;

  /**
   * Names of the values of an integer, e.g. `{ O_CREAT: 0x40 }`. Used by `decoder: enum` and `decoder: flags` for native
   * hooks, and by `decoder: constant` for Java hooks instead of the constants of the hooked class.
   */
  constants?: Record<string, number>;

  /**
   * Regular expressions matched against the decoded value. The event is only captured if at least one
   * matches. Only string and number values are filtered; other values always pass.
   */
  argFilter?: string[];
}

/**
 * A value passed to a decoder: the name of another parameter, `$ret` for the return value (only for a parameter with
 * `direction: out`), or a number.
 *
 * @public
 */
export type DecoderArgValue = string | number;

/**
 * The roles a value can have for a decoder. Each role means the same for every decoder that accepts it.
 *
 * @public
 */
export interface DecoderArgs {
  /**
   * Role `length`: how many elements to decode, e.g. the number of bytes of a buffer or of elements of an array.
   */
  length?: DecoderArgValue;

  /**
   * Role `offset`: how many elements to skip before decoding, e.g. where a slice starts in a Java `byte[]`.
   */
  offset?: DecoderArgValue;
}

export interface FrookySettings {
  hookSettings: HookSettings;
  decoderSettings: DecoderSettings;
}
