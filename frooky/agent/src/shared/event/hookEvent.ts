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
  // Java hooks: what the method threw instead of returning, e.g. `java.io.FileNotFoundException: /missing (No such
  // file or directory)`
  exception?: string;

  constructor(decodedArgs?: DecodedArgs, returnValue?: DecodedValue, stackTrace?: HookStackTrace) {
    super();
    if (decodedArgs) {
      this.argsIn = decodedArgs.in;
      this.argsOut = decodedArgs.out;
    }
    this.returnValue = returnValue;
    this.stackTrace = stackTrace;
  }

  // the fields naming the hooked method or function, e.g. `javaClass` and `method`
  protected abstract targetFields(): Record<string, unknown>;

  // sets the order of the fields in the output
  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      timestamp: this.timestamp,
      type: this.type,
      ...this.targetFields(),
      hashCode: this.hashCode,
      argsIn: this.argsIn,
      argsOut: this.argsOut,
      returnValue: this.returnValue,
      exception: this.exception,
      stackTrace: this.stackTrace,
    };
  }
}
