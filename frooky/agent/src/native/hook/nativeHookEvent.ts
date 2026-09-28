import { DecodedValue } from "../../shared/decoders/decodedValue";
import { HookEvent } from "../../shared/event/hookEvent";
import { DecodedArgs } from "../../shared/hook/hookManager";
import { HookStackTrace } from "../../shared/platformStackTrace";
import { NativeHook } from "./nativeHook";

export class NativeHookEvent extends HookEvent {
  module: string;

  // for hooks declared with `symbol`
  symbol?: string;

  // for hooks declared with `offset`
  offset?: string;

  // with `hashCode: true`: the function's address, since native calls have no instance
  hashCode?: string;

  constructor(hook: NativeHook, decodedArgs?: DecodedArgs, returnValue?: DecodedValue, stackTrace?: HookStackTrace) {
    super(decodedArgs, returnValue, stackTrace);
    this.type += "-native";
    this.module = hook.module.name;
    this.symbol = hook.symbolName;
    this.offset = hook.offset;
    this.hashCode = hook.decoderSettings.hashCode ? hook.symbolAddress.toString() : undefined;
  }
}
