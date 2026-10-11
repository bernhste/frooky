import { FrookyMetadata as InputFrookyMetadata } from "./frookyMetadata";
import { InputJavaHookCollection } from "./inputParsing/inputJavaHookCollection";
import { InputNativeHookCollection } from "./inputParsing/inputNativeHookCollection";
import { InputDecoderSettings, InputHookSettings } from "./inputParsing/inputSettings";

// The version of the hook-file format this agent reads
export const SCHEMA_VERSION = 1;

/**
 * Root of a frooky hook file.
 *
 * @public
 */
export interface InputFrookyConfig {
  /**
   * Version of the hook-file format the file is written in. Default: `1`.
   */
  schemaVersion?: 1;

  /**
   * Descriptive information about the hook file.
   */
  metadata?: InputFrookyMetadata;

  /**
   * Default hook settings for all hooks in this file. Can be overridden per hook collection or hook.
   */
  hookSettings?: InputHookSettings;

  /**
   * Default decoder settings for all parameters and return values in this file. Can be overridden per hook collection,
   * hook, parameter or return value.
   */
  decoderSettings?: InputDecoderSettings;

  /**
   * Java and native hook collections to install.
   */
  hookCollections: (InputJavaHookCollection | InputNativeHookCollection)[];
}
