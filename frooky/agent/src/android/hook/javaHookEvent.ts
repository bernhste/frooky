import { DecodedValue } from "../../shared/decoders/decodedValue";
import { HookEvent } from "../../shared/event/hookEvent";
import { DecodedArgs } from "../../shared/hook/hookManager";
import { HookStackTrace } from "../../shared/platformStackTrace";
import { MethodType } from "./androidHookManager";
import { hookedClassName, JavaHook } from "./javaHook";

export class JavaHookEvent extends HookEvent {
  readonly javaClass: string;
  // the superclass that declares the method, for a method the hooked class inherits
  readonly declaringClass?: string;
  readonly method: string;
  readonly methodType: MethodType;

  constructor(
    hook: JavaHook,
    methodType: MethodType,
    hashCode: string | undefined,
    decodedArgs?: DecodedArgs,
    returnValue?: DecodedValue,
    stackTrace?: HookStackTrace,
  ) {
    super(decodedArgs, returnValue, stackTrace);
    this.type += "-java";
    this.javaClass = hookedClassName(hook);
    if (hook.inheritedBy) this.declaringClass = String(hook.method.holder.$className);
    this.method = hook.methodName;
    this.methodType = methodType;
    this.hashCode = hashCode;
  }

  protected targetFields(): Record<string, unknown> {
    return { javaClass: this.javaClass, declaringClass: this.declaringClass, method: this.method, methodType: this.methodType };
  }
}
