import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { HookValidator } from "../../shared/hook/hookValidator";
import { InputObjcHookCollection, InputObjcHookNormalized } from "../../shared/inputParsing/inputObjcHookCollection";
import { InputSwiftHookCollection, InputSwiftHookNormalized } from "../../shared/inputParsing/inputSwiftHookCollection";
import { ObjcHookValidator } from "../objc/hook/objcHookValidator";
import { SwiftHookValidator } from "../swift/hook/swiftHookValidator";

export type IosInputHookNormalized = InputObjcHookNormalized | InputSwiftHookNormalized;
export type IosInputHookCollection = InputObjcHookCollection | InputSwiftHookCollection;

// Collects the hooks of the validators of each iOS bridge (Objective-C, Swift).
export class IosHookValidator implements HookValidator<IosInputHookNormalized, IosInputHookCollection> {
  private readonly objcHookValidator = new ObjcHookValidator();
  private readonly swiftHookValidator = new SwiftHookValidator();

  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): IosInputHookNormalized[] {
    return [
      ...this.objcHookValidator.validateAndNormalizeHooks(inputFrookyConfig, settings),
      ...this.swiftHookValidator.validateAndNormalizeHooks(inputFrookyConfig, settings),
    ];
  }

  getPlatformHookCollections(inputFrookyConfig: InputFrookyConfig): IosInputHookCollection[] {
    return [
      ...this.objcHookValidator.getPlatformHookCollections(inputFrookyConfig),
      ...this.swiftHookValidator.getPlatformHookCollections(inputFrookyConfig),
    ];
  }
}
