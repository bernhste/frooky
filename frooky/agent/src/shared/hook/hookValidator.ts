import { InputFrookyConfig } from "../frookyConfig";
import { FrookySettings } from "../frookySettings";

export interface HookValidator<THookNormalized, THookCollection> {
  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): THookNormalized[];
  getPlatformHookCollections(inputFrookyConfig: InputFrookyConfig): THookCollection[];
}
