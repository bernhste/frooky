import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { HookEvent } from "../../../shared/event/hookEvent";
import { DecodedArgs } from "../../../shared/hook/hookManager";
import { HookStackTrace } from "../../../shared/platformStackTrace";
import { ObjcHook } from "./objcHook";

export class ObjcHookEvent extends HookEvent {
  readonly objcClassName: string;
  readonly method: string;
  readonly methodType: "instance" | "class";
  // address of the receiver (`self`), only for instance methods
  readonly instance?: string;

  constructor(hook: ObjcHook, instance?: string, decodedArgs?: DecodedArgs, returnValue?: DecodedValue, stackTrace?: HookStackTrace) {
    super(decodedArgs, returnValue, stackTrace);
    this.type += "-objc";
    this.objcClassName = hook.objcClass;
    this.method = hook.selector;
    this.methodType = hook.methodType;
    this.instance = instance;
  }
}
