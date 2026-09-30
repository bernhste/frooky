import { DecodedValue } from "../decoders/decodedValue";
import { DecodedArgs } from "../hook/hookManager";
import { HookStackTrace } from "../platformStackTrace";
import { BaseEvent } from "./baseEvent";

export abstract class HookEvent extends BaseEvent {
  type = "hook";
  stackTrace?: HookStackTrace;
  // 32-bit hex: `System.identityHashCode()` of the instance for Java hooks (none for static methods), a hash of the
  // function's address for native hooks
  hashCode?: string;
  // params decoded on entry (direction `in`/`inout`) and on return (`out`/`inout`)
  argsIn?: DecodedValue[];
  argsOut?: DecodedValue[];
  returnValue?: DecodedValue;

  constructor(decodedArgs?: DecodedArgs, returnValue?: DecodedValue, stackTrace?: HookStackTrace) {
    super();
    if (decodedArgs) {
      this.argsIn = decodedArgs.in;
      this.argsOut = decodedArgs.out;
    }
    this.returnValue = returnValue;
    this.stackTrace = stackTrace;
  }
}
