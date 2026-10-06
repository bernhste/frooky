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
   * Whether native hooks skip the wait until the app's own code is about to run (`targetReady`). When `true`, they
   * are installed at spawn, or while the linker loads their module, before its constructors and `JNI_OnLoad` run, e.g.
   * to observe anti-tampering checks. Give high-frequency libc functions a `callerFilter`. Only matters when
   * spawning (`-f`). Default: `false`.
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
   * Filter patterns matched against the decoded value: numeric comparisons (`> 100`, `>= 0`, `< 10`, `<= 50`, `== 42`,
   * `!= -1`) against numbers, or regular expressions against strings and numbers. The event is only captured if at least
   * one matches. Lists, booleans and `null` always pass.
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
   * Names of the values of an integer, e.g. `{ O_CREAT: 0x40 }`, for `decoder: constants` and `decoder: bitmask`. In Java
   * hooks, it can't be combined with `class` and `fields`.
   */
  constants?: Record<string, number>;

  /**
   * Java hooks: the class whose `static final` fields are the constants of `decoder: constants` and `decoder: bitmask`,
   * e.g. `javax.crypto.Cipher`. Only the fields of the type of the value are used. Default: the hooked class.
   */
  class?: string;

  /**
   * Java hooks: a pattern for the names of the fields of `class` (or of the hooked class) that are the constants, in
   * which `*` matches any characters, e.g. `*_MODE`. Default: all fields.
   */
  fields?: string;
}

/**
 * Decoders of Java hooks, selected with `decoder:`: the decoders of every platform (`string`, `base64`, `hex`,
 * `constants`, `bitmask`) and `getters` and `hashCode`. See docs/decoders.md.
 *
 * @public
 */
export type JavaDecoderName = "string" | "base64" | "hex" | "hashCode" | "constants" | "bitmask" | "getters";

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
 * Decoders of native hooks, selected with `decoder:`: the decoders of every platform (`string`, `base64`, `hex`,
 * `constants`, `bitmask`), `utf16`, `errno`, `fd`, `nullTerminated` and the presets. See docs/decoders.md.
 *
 * @public
 */
export type NativeDecoderName =
  | "string"
  | "base64"
  | "hex"
  | "utf16"
  | "errno"
  | "fd"
  | "constants"
  | "bitmask"
  | "nullTerminated"
  | NativeBitmaskPresetName
  | NativeConstantsPresetName;

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
