import z from "zod";
import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { HookValidator } from "../../shared/hook/hookValidator";
import {
  InputJavaHookCollection,
  InputJavaHookNormalized,
  isJavaHookScope,
  mergeJavaHookCollectionSettings,
  normalizeJavaHook,
} from "../../shared/inputParsing/inputJavaHookCollection";
import { inputJavaHookNormalizedSchema } from "../../shared/inputParsing/zodSchemas/inputJavaHookCollection.zod";
import { logger } from "../../shared/logger";

export class AndroidHookValidator implements HookValidator<InputJavaHookNormalized, InputJavaHookCollection> {
  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): InputJavaHookNormalized[] {
    const javaHookCollections = this.getPlatformHookCollections(inputFrookyConfig);
    const normalizedJavaHooks: InputJavaHookNormalized[] = [];

    for (const javaHookCollection of javaHookCollections) {
      const { hookSettings, decoderSettings } = mergeJavaHookCollectionSettings(javaHookCollection, settings);
      for (const inputJavaHook of javaHookCollection.hooks) {
        try {
          const normalizedJavaHook = normalizeJavaHook(javaHookCollection.javaClass, inputJavaHook, hookSettings, decoderSettings);
          normalizedJavaHooks.push(inputJavaHookNormalizedSchema.parse(normalizedJavaHook));
        } catch (e) {
          const method = typeof inputJavaHook === "string" ? inputJavaHook : inputJavaHook.method;
          const validationError = e instanceof z.ZodError ? z.prettifyError(e) : String(e instanceof Error ? e.message : e);
          logger.warn([
            `Skipping hook for java method '${method}' from class '${javaHookCollection.javaClass}' due to an invalid declaration.`,
            `Validation error:\n${validationError}`,
          ]);
        }
      }
    }
    logger.debug(`Normalized Java hook: ${JSON.stringify(normalizedJavaHooks, null, 2)}`);
    return normalizedJavaHooks;
  }

  getPlatformHookCollections(inputFrookyConfig: InputFrookyConfig): InputJavaHookCollection[] {
    const platformHookCollection: InputJavaHookCollection[] = [];
    for (const hookScope of inputFrookyConfig.hookCollection) {
      if (isJavaHookScope(hookScope)) {
        platformHookCollection.push(hookScope);
      }
    }
    return platformHookCollection;
  }
}
