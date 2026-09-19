import z from "zod";
import { InputFrookyConfig } from "../../../shared/frookyConfig";
import { FrookySettings } from "../../../shared/frookySettings";
import { HookValidator } from "../../../shared/hook/hookValidator";
import {
  InputObjcHookCollection,
  InputObjcHookNormalized,
  isObjcHookCollection,
  mergeObjcHookCollectionSettings,
  normalizeObjcHook,
} from "../../../shared/inputParsing/inputObjcHookCollection";
import { inputObjcHookNormalizedSchema } from "../../../shared/inputParsing/zodSchemas/inputObjcHookCollection.zod";
import { logger } from "../../../shared/logger";

export class ObjcHookValidator implements HookValidator<InputObjcHookNormalized, InputObjcHookCollection> {
  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): InputObjcHookNormalized[] {
    const objcHookCollections = this.getPlatformHookCollections(inputFrookyConfig);
    const normalizedObjcHooks: InputObjcHookNormalized[] = [];

    for (const objcHookCollection of objcHookCollections) {
      const { hookSettings, decoderSettings } = mergeObjcHookCollectionSettings(objcHookCollection, settings);
      for (const inputObjcHook of objcHookCollection.hooks) {
        try {
          const normalizedObjcHook = normalizeObjcHook(objcHookCollection.objcClass, inputObjcHook, hookSettings, decoderSettings);
          normalizedObjcHooks.push(inputObjcHookNormalizedSchema.parse(normalizedObjcHook));
        } catch (e) {
          const method = typeof inputObjcHook === "string" ? inputObjcHook : Array.isArray(inputObjcHook) ? inputObjcHook[0] : inputObjcHook.method;
          const validationError = e instanceof z.ZodError ? z.prettifyError(e) : String(e instanceof Error ? e.message : e);
          logger.warn([
            `Skipping hook for Objective-C method '${method}' from class '${objcHookCollection.objcClass}' due to an invalid declaration.`,
            `Validation error:\n${validationError}`,
          ]);
        }
      }
    }
    logger.debug(`Normalized Objective-C hook: ${JSON.stringify(normalizedObjcHooks, null, 2)}`);
    return normalizedObjcHooks;
  }

  getPlatformHookCollections(inputFrookyConfig: InputFrookyConfig): InputObjcHookCollection[] {
    return inputFrookyConfig.hookCollection.filter(isObjcHookCollection);
  }
}
