import { DecodedValue } from "../../shared/decoders/decodedValue";
import { HookEvent } from "../../shared/event/hookEvent";
import { DecodedArgs } from "../../shared/hook/hookManager";
import { HookStackTrace } from "../../shared/platformStackTrace";
import { formatHashCode } from "../../shared/utils";
import { NativeHook } from "./nativeHook";

export class NativeHookEvent extends HookEvent {
  module: string;

  // for hooks declared with `symbol`
  symbol?: string;

  // for hooks declared with `offset`
  offset?: string;

  // the hooked function's address in the process, e.g. `0x7b3c2a1f40`
  address: string;

  constructor(hook: NativeHook, hashCode: string, decodedArgs?: DecodedArgs, returnValue?: DecodedValue, stackTrace?: HookStackTrace) {
    super(decodedArgs, returnValue, stackTrace);
    this.type += "-native";
    this.module = hook.module.name;
    this.symbol = hook.symbolName;
    this.offset = hook.offset;
    this.address = hook.symbolAddress.toString();
    this.hashCode = hashCode;
  }
}

// The 32-bit hash code of a function's address, as native calls have no instance. Computed like Java's
// `Long.hashCode()` (the upper and lower 32 bits XORed), and formatted like a Java hash code.
export function addressHashCode(address: NativePointer): string {
  return formatHashCode(address.and(0xffffffff).toUInt32() ^ address.shr(32).toUInt32());
}
