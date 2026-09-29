import { FrookyMetadata as InputFrookyMetadata } from "./frookyMetadata";
import { InputJavaHookCollection } from "./inputParsing/inputJavaHookCollection";
import { InputObjcHookCollection } from "./inputParsing/inputObjcHookCollection";
import { InputSwiftHookCollection } from "./inputParsing/inputSwiftHookCollection";
import { InputNativeHookCollection } from "./inputParsing/inputNativeHookCollection";
import { InputFrookySettings } from "./inputParsing/inputSettings";

/**
 * Root of a frooky hook file.
 *
 * @public
 */
export interface InputFrookyConfig {
  /**
   * Descriptive information about the hook file.
   */
  metadata?: InputFrookyMetadata;

  /**
   * Default settings for all hooks in this file. Can be overridden per hook collection, hook or parameter.
   */
  settings?: InputFrookySettings;

  /**
   * Java, Objective-C, Swift and native hook collections to install.
   */
  hookCollection: (InputJavaHookCollection | InputObjcHookCollection | InputSwiftHookCollection | InputNativeHookCollection)[];
}
