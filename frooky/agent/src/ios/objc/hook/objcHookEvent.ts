import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { HookEvent } from "../../../shared/event/hookEvent";
import { DecodedArgs } from "../../../shared/hook/hookManager";
import { ObjcHook } from "./objcHook";

/**
 * Class representing an Objective-C hook event
 *
 * Extends {@link HookEvent} with hook-specific fields.
 */
export class ObjcHookEvent extends HookEvent {
  readonly objcClassName: string;
  readonly method: string;
  readonly methodType: "instance" | "class";
  /** Address of the receiver (`self`). Only set for instance methods. */
  readonly instance?: string;

  constructor(hook: ObjcHook, instance?: string, decodedArgs?: DecodedArgs, returnValue?: DecodedValue, stackTrace?: string[]) {
    super(decodedArgs, returnValue, stackTrace);
    this.type += "-objc";
    this.objcClassName = hook.objcClass;
    this.method = hook.selector;
    this.methodType = hook.methodType;
    this.instance = instance;
  }
}
