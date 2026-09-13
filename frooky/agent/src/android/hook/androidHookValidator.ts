import z from "zod";
import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { HookValidator } from "../../shared/hook/hookValidator";
import { InputJavaHookGroup, InputJavaHookNormalized, isJavaHookScope, mergeJavaHookGroupSettings, normalizeJavaHook } from "../../shared/inputParsing/inputJavaHookGroup";
import { inputJavaHookNormalizedSchema } from "../../shared/inputParsing/zodSchemas/inputJavaHookGroup.zod";
import { logger } from "../../shared/logger";

export class AndroidHookValidator implements HookValidator<InputJavaHookNormalized, InputJavaHookGroup> {
  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): InputJavaHookNormalized[] {
    const javaHookGroups = this.getPlatformHookGroups(inputFrookyConfig);
    const normalizedJavaHooks: InputJavaHookNormalized[] = [];

    for (const javaHookGroup of javaHookGroups) {
      const { hookSettings, decoderSettings } = mergeJavaHookGroupSettings(javaHookGroup, settings);
      for (const inputJavaHook of javaHookGroup.hooks) {
        try {
          const normalizedJavaHook = normalizeJavaHook(javaHookGroup.javaClass, inputJavaHook, hookSettings, decoderSettings);
          normalizedJavaHooks.push(inputJavaHookNormalizedSchema.parse(normalizedJavaHook));
        } catch (e) {
          const method = typeof inputJavaHook === "string" ? inputJavaHook : inputJavaHook.method;
          const validationError = e instanceof z.ZodError ? z.prettifyError(e) : String(e instanceof Error ? e.message : e);
          logger.warn([
            `Skipping hook for java method '${method}' from class '${javaHookGroup.javaClass}' due to an invalid declaration.`,
            `Validation error:\n${validationError}`,
          ]);
        }
      }
    }
    return normalizedJavaHooks;
  }

  getPlatformHookGroups(inputFrookyConfig: InputFrookyConfig): InputJavaHookGroup[] {
    const platformHookGroup: InputJavaHookGroup[] = [];
    for (const hookScope of inputFrookyConfig.hookGroup) {
      if (isJavaHookScope(hookScope)) {
        platformHookGroup.push(hookScope);
      }
    }
    return platformHookGroup;
  }
}
