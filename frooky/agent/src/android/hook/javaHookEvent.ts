import { DecodedValue } from "../../shared/decoders/decodedValue";
import { HookEvent } from "../../shared/event/hookEvent";
import { DecodedArgs } from "../../shared/hook/hookManager";
import { HookStackTrace } from "../../shared/platformStackTrace";
import { FieldType } from "./androidHookManager";
import { hookedClassName, JavaHook } from "./javaHook";

export class JavaHookEvent extends HookEvent {
  readonly javaClassName: string;
  // the superclass that declares the method, for a method the hooked class inherits
  readonly declaringClass?: string;
  readonly method: string;
  readonly fieldType: FieldType;

  constructor(
    hook: JavaHook,
    fieldType: FieldType,
    hashCode: string | undefined,
    decodedArgs?: DecodedArgs,
    returnValue?: DecodedValue,
    stackTrace?: HookStackTrace,
  ) {
    super(decodedArgs, returnValue, stackTrace);
    this.type += "-java";
    this.javaClassName = hookedClassName(hook);
    if (hook.inheritedBy) this.declaringClass = String(hook.method.holder.$className);
    this.method = hook.methodName;
    this.fieldType = fieldType;
    this.hashCode = hashCode;
  }
}
