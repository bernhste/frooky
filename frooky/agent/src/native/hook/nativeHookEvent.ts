import { DecodedValue } from "../../shared/decoders/decodedValue";
import { HookEvent } from "../../shared/event/hookEvent";
import { DecodedArgs } from "../../shared/hook/hookManager";
import { NativeHook } from "./nativeHook";

/**
 * Represents a native hook event created by frooky.
 *
 * Extends {@link HookEvent} with native-specific fields for module and symbol information.
 * ```
 */
export class NativeHookEvent extends HookEvent {
  /** Module the hooked function is located in. */
  module: string;

  /** Symbol of the hooked function. */
  symbol: string;

  /** Address of the hooked function. */
  address?: NativePointer;

  /**
   * Identifies the hooked function, for compatibility with {@link DecoderSettings.hashCode}. Native
   * hooks have no per-call instance the way java hooks do, so this is just the function's own address
   * (the same value on every call to this hook) rather than a per-invocation identity.
   */
  hashCode?: string;

  constructor(hook: NativeHook, decodedArgs?: DecodedArgs, returnValue?: DecodedValue, stackTrace?: string[]) {
    super(decodedArgs, returnValue, stackTrace);
    this.type += "-native";
    this.module = hook.module.name;
    this.symbol = hook.symbolName;
    this.hashCode = hook.decoderSettings.hashCode ? hook.symbolAddress.toString() : undefined;
  }
}
