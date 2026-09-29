import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { HookEvent } from "../../../shared/event/hookEvent";
import { DecodedArgs } from "../../../shared/hook/hookManager";
import { HookStackTrace } from "../../../shared/platformStackTrace";
import { SwiftHook } from "./swiftHook";

export class SwiftHookEvent extends HookEvent {
  readonly swiftTypeName: string;
  readonly swiftKind: "class" | "struct" | "enum";
  readonly method: string;
  // the demangled symbol of the hooked overload
  readonly symbol: string;
  // address of the receiver (`self`), only for methods of classes
  readonly instance?: string;

  constructor(hook: SwiftHook, instance?: string, decodedArgs?: DecodedArgs, returnValue?: DecodedValue, stackTrace?: HookStackTrace) {
    super(decodedArgs, returnValue, stackTrace);
    this.type += "-swift";
    this.swiftTypeName = hook.swiftType;
    this.swiftKind = hook.swiftKind;
    this.method = hook.methodName;
    this.symbol = hook.methodSymbol;
    this.instance = instance;
  }
}
