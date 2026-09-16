import Java from "frida-java-bridge";
import { Param } from "../../shared/decoders/decodable";
import { DecoderSettings } from "../../shared/frookySettings";
import { Hook } from "../../shared/hook/hook";

/**
 * Contains all information to hook a java method
 *
 * @public
 */
export interface JavaHook extends Hook {
  method: Java.Method;
  methodName: string;
  params?: Param[];

  /**
   * Decoder settings for this overload's return value, taken from its `retType` declaration.
   * The return type itself always comes from Java reflection, never from user input.
   * Falls back to {@link Hook.decoderSettings} when not set.
   */
  retTypeSettings?: DecoderSettings;
}
