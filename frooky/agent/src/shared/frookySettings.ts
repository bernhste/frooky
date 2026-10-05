/**
 * Settings that control how a hook captures events.
 *
 * @public
 */
export interface HookSettings {
  /**
   * Maximum number of stack frames captured per event. Default: `5`.
   *
   * @minimum 0
   */
  maxStackFrames: number;

  /**
   * Whether to capture native (C/C++) stack frames. Default: `false`.
   */
  nativeStackTrace: boolean;

  /**
   * Whether to capture platform (managed runtime, e.g. Java) stack frames. Default: `false`.
   */
  platformStackTrace: boolean;

  /**
   * Regular expressions; the call is only captured if its caller matches one of them. Java hooks match the methods
   * on the Java stack as `<class>.<method>`, e.g. `'^com\.myapp\.'`. Native hooks match the name of the module
   * that called the function directly, e.g. `'^libapp\.so$'`. Default: `[]`.
   */
  callerFilter: string[];

  /**
   * Whether to install native hooks early, before the platform runtime (e.g. Android ART) is ready.
   * When `false` (default), hooks are gated behind `platformReady` to prevent early bootstrap crashes and deadlocks.
   * When `true`, hooks are installed immediately at process start or during dynamic linker module loading
   * (e.g. to inspect `.init_array` constructors or anti-tampering routines). Default: `false`.
   */
  early: boolean;
}

/**
 * Decoder settings that the file, a hook collection, a hook, a parameter and a return value can set. Each level passes
 * them on to the levels inside it, which can override them.
 *
 * @public
 */
export interface BaseDecoderSettings {
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
   * Name of the decoder to use instead of the one chosen from the declared type. Java and native hooks each have their
   * own decoders, see {@link JavaDecoderName} and {@link NativeDecoderName}.
   */
  decoder?: DecoderName;
}

/**
 * Settings that control how a parameter or return value is decoded: the {@link BaseDecoderSettings} and the settings
 * that only a single parameter or return value can have.
 *
 * @public
 */
export interface DecoderSettings extends BaseDecoderSettings {
  /**
   * Values the decoder needs to decode the parameter, by their role, e.g. `{ length: len }` for a buffer whose length is
   * in the parameter `len`. Each decoder accepts some roles; any other role makes the hook invalid.
   */
  decoderArgs?: DecoderArgs;

  /**
   * Options of the decoder selected with `decoder:`, e.g. `{ constants: { O_CREAT: 0x40 } }`. Each decoder accepts some
   * options; any other option makes the hook invalid.
   */
  config?: DecoderConfig;

  /**
   * Regular expressions matched against the decoded value. The event is only captured if at least one
   * matches. Only string and number values are filtered; other values always pass.
   */
  argFilter?: string[];
}

/**
 * Options of a decoder, set with `config:` next to `decoder:`.
 *
 * @public
 */
export interface DecoderConfig {
  /**
   * Names of the values of an integer, for `decoder: constants` and `decoder: bitmask`: a map, e.g.
   * `{ O_CREAT: 0x40 }`, or in Java hooks a class whose `static final` fields are the constants, e.g.
   * `javax.crypto.Cipher`, optionally with a pattern for the field names after `#`, e.g. `javax.crypto.Cipher#*_MODE`.
   * Java `constants` without it uses the constants of the hooked class.
   */
  constants?: Record<string, number> | string;
}

/**
 * Decoders of Java hooks, selected with `decoder:`. See docs/decoders-java.md.
 *
 * @public
 */
export type JavaDecoderName = "string" | "base64" | "hashCode" | "intentFlag" | "intentUriFlag" | "constants" | "bitmask" | "getters";

/**
 * Decoders of native hooks that decode an integer bitmask with built-in constants, like `decoder: bitmask`.
 *
 * @public
 */
export type NativeBitmaskPresetName = "openFlags" | "mmapProt" | "mmapFlags" | "dlopenFlags" | "socketType";

/**
 * Decoders of native hooks that decode an integer with built-in constants, like `decoder: constants`.
 *
 * @public
 */
export type NativeConstantsPresetName = "socketDomain";

/**
 * Decoders of native hooks, selected with `decoder:`. See docs/decoders-native.md.
 *
 * @public
 */
export type NativeDecoderName =
  "string" | "base64" | "utf16" | "errno" | "fd" | "constants" | "bitmask" | "nullTerminated" | NativeBitmaskPresetName | NativeConstantsPresetName;

/**
 * Name of a decoder of any platform. Settings outside a hook collection, e.g. the top-level `decoderSettings`, accept
 * both; a hook only the decoders of its platform.
 *
 * @public
 */
export type DecoderName = JavaDecoderName | NativeDecoderName;

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
  decoderSettings: BaseDecoderSettings;
}
