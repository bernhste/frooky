import { DecodedValue } from "../../shared/decoders/decodedValue";
import { HookEvent } from "../../shared/event/hookEvent";
import { DecodedArgs } from "../../shared/hook/hookManager";
import { FieldType } from "./androidHookManager";
import { JavaHook } from "./javaHook";

/**
 * Class representing a java hook event
 *
 * Extends {@link HookEvent} with hook-specific fields.
 * ```
 */
export class JavaHookEvent extends HookEvent {
  readonly javaClassName: string;
  readonly method: string;
  readonly fieldType: FieldType;

  constructor(hook: JavaHook, fieldType: FieldType, decodedArgs?: DecodedArgs, returnValue?: DecodedValue, stackTrace?: string[]) {
    super(decodedArgs, returnValue, stackTrace);
    this.type += "-java";
    this.javaClassName = String(hook.method.holder.$className);
    this.method = hook.methodName;
    this.fieldType = fieldType;
  }
}
