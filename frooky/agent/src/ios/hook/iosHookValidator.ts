import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { HookValidator } from "../../shared/hook/hookValidator";
import { InputObjcHookCollection, InputObjcHookNormalized } from "../../shared/inputParsing/inputObjcHookCollection";
import { ObjcHookValidator } from "../objc/hook/objcHookValidator";

export type IosInputHookNormalized = InputObjcHookNormalized;
export type IosInputHookCollection = InputObjcHookCollection;

/**
 * Validates the hooks of all iOS bridges. Every bridge has its own validator, this class only collects the results.
 */
export class IosHookValidator implements HookValidator<IosInputHookNormalized, IosInputHookCollection> {
  private readonly objcHookValidator = new ObjcHookValidator();

  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): IosInputHookNormalized[] {
    return [...this.objcHookValidator.validateAndNormalizeHooks(inputFrookyConfig, settings)];
  }

  getPlatformHookCollections(inputFrookyConfig: InputFrookyConfig): IosInputHookCollection[] {
    return [...this.objcHookValidator.getPlatformHookCollections(inputFrookyConfig)];
  }
}
