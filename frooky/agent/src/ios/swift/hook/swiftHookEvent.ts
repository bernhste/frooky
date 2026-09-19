import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { HookEvent } from "../../../shared/event/hookEvent";
import { DecodedArgs } from "../../../shared/hook/hookManager";
import { SwiftHook } from "./swiftHook";

/**
 * Class representing a Swift hook event
 *
 * Extends {@link HookEvent} with hook-specific fields.
 */
export class SwiftHookEvent extends HookEvent {
  readonly swiftTypeName: string;
  readonly swiftKind: "class" | "struct" | "enum";
  readonly method: string;
  /** The demangled symbol of the hooked overload. */
  readonly symbol: string;
  /** Address of the receiver (`self`). Only set for methods of classes. */
  readonly instance?: string;

  constructor(hook: SwiftHook, instance?: string, decodedArgs?: DecodedArgs, returnValue?: DecodedValue, stackTrace?: string[]) {
    super(decodedArgs, returnValue, stackTrace);
    this.type += "-swift";
    this.swiftTypeName = hook.swiftType;
    this.swiftKind = hook.swiftKind;
    this.method = hook.methodName;
    this.symbol = hook.methodSymbol;
    this.instance = instance;
  }
}
