import { DecodedValue } from "../../shared/decoders/decodedValue";
import { HookEvent } from "../../shared/event/hookEvent";
import { DecodedArgs } from "../../shared/hook/hookManager";
import { HookStackTrace } from "../../shared/platformStackTrace";
import { FieldType } from "./androidHookManager";
import { JavaHook } from "./javaHook";

export class JavaHookEvent extends HookEvent {
  readonly javaClassName: string;
  readonly method: string;
  readonly fieldType: FieldType;

  constructor(hook: JavaHook, fieldType: FieldType, decodedArgs?: DecodedArgs, returnValue?: DecodedValue, stackTrace?: HookStackTrace) {
    super(decodedArgs, returnValue, stackTrace);
    this.type += "-java";
    this.javaClassName = String(hook.method.holder.$className);
    this.method = hook.methodName;
    this.fieldType = fieldType;
  }
}
