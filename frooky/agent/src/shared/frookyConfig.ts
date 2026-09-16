import { FrookyMetadata as InputFrookyMetadata } from "./frookyMetadata";
import { InputJavaHookCollection } from "./inputParsing/inputJavaHookCollection";
import { InputNativeHookCollection } from "./inputParsing/inputNativeHookCollection";
import { InputFrookySettings } from "./inputParsing/inputSettings";

/**
 * frooky configuration.
 */
export interface InputFrookyConfig {
  /**
   * Metadata about the hook collection
   */
  metadata?: InputFrookyMetadata;

  /**
   * Settings applied to all hooks in this frooky config
   */
  settings?: InputFrookySettings;

  /**
   * Collection of hooks.
   */
  hookCollection: (InputJavaHookCollection | InputNativeHookCollection)[];
}
