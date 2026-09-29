import z from "zod";
import { InputFrookyConfig } from "../../../shared/frookyConfig";
import { FrookySettings } from "../../../shared/frookySettings";
import { HookValidator } from "../../../shared/hook/hookValidator";
import {
  InputSwiftHookCollection,
  getSwiftOwner,
  InputSwiftHookNormalized,
  isSwiftHookCollection,
  mergeSwiftHookCollectionSettings,
  normalizeSwiftHook,
  swiftOwnerName,
} from "../../../shared/inputParsing/inputSwiftHookCollection";
import { inputSwiftHookNormalizedSchema } from "../../../shared/inputParsing/zodSchemas/inputSwiftHookCollection.zod";
import { logger } from "../../../shared/logger";

export class SwiftHookValidator implements HookValidator<InputSwiftHookNormalized, InputSwiftHookCollection> {
  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): InputSwiftHookNormalized[] {
    const swiftHookCollections = this.getPlatformHookCollections(inputFrookyConfig);
    const normalizedSwiftHooks: InputSwiftHookNormalized[] = [];

    for (const swiftHookCollection of swiftHookCollections) {
      const { hookSettings, decoderSettings } = mergeSwiftHookCollectionSettings(swiftHookCollection, settings);
      const owner = getSwiftOwner(swiftHookCollection);
      for (const inputSwiftHook of swiftHookCollection.hooks) {
        try {
          const normalizedSwiftHook = normalizeSwiftHook(owner, inputSwiftHook, hookSettings, decoderSettings);
          normalizedSwiftHooks.push(inputSwiftHookNormalizedSchema.parse(normalizedSwiftHook));
        } catch (e) {
          const method =
            typeof inputSwiftHook === "string" ? inputSwiftHook : Array.isArray(inputSwiftHook) ? inputSwiftHook[0] : inputSwiftHook.method;
          const validationError = e instanceof z.ZodError ? z.prettifyError(e) : String(e instanceof Error ? e.message : e);
          logger.warn(
            `Skipping hook for Swift method '${method}' from '${swiftOwnerName(owner)}' due to an invalid declaration:\n${validationError}`,
          );
        }
      }
    }
    logger.debug(`Normalized Swift hook: ${JSON.stringify(normalizedSwiftHooks, null, 2)}`);
    return normalizedSwiftHooks;
  }

  getPlatformHookCollections(inputFrookyConfig: InputFrookyConfig): InputSwiftHookCollection[] {
    return inputFrookyConfig.hookCollection.filter(isSwiftHookCollection);
  }
}
