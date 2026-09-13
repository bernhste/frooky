import z from "zod";

import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { HookValidator } from "../../shared/hook/hookValidator";
import {
  InputNativeHookGroup,
  InputNativeHookNormalized,
  isNativeHookGroup,
  mergeNativeHookGroupSettings,
  normalizeNativeHook,
} from "../../shared/inputParsing/inputNativeHookGroup";
import { inputNativeHookNormalizedSchema } from "../../shared/inputParsing/zodSchemas/inputNativeHookGroup.zod";
import { logger } from "../../shared/logger";

export class NativeHookValidator implements HookValidator<InputNativeHookNormalized, InputNativeHookGroup> {
  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): InputNativeHookNormalized[] {
    const nativeHookGroups = this.getPlatformHookGroups(inputFrookyConfig);
    const normalizedNativeHooks: InputNativeHookNormalized[] = [];

    for (const nativeHookGroup of nativeHookGroups) {
      const { hookSettings, decoderSettings } = mergeNativeHookGroupSettings(nativeHookGroup, settings);
      for (const inputNativeHook of nativeHookGroup.hooks) {
        try {
          const normalizedNativeHook = normalizeNativeHook(inputNativeHook, nativeHookGroup.module, hookSettings, decoderSettings);
          normalizedNativeHooks.push(inputNativeHookNormalizedSchema.parse(normalizedNativeHook));
        } catch (e) {
          const symbol = typeof inputNativeHook === "string" ? inputNativeHook : inputNativeHook.symbol;
          const validationError = e instanceof z.ZodError ? z.prettifyError(e) : String(e instanceof Error ? e.message : e);
          logger.warn([
            `Skipping hook for function with the symbol name '${symbol}' from module '${nativeHookGroup.module}' due to an invalid declaration.`,
            `Validation error:\n${validationError}`,
          ]);
        }
      }
    }
    return normalizedNativeHooks;
  }

  getPlatformHookGroups(inputFrookyConfig: InputFrookyConfig): InputNativeHookGroup[] {
    const platformHookGroup: InputNativeHookGroup[] = [];
    for (const hookScope of inputFrookyConfig.hookGroup) {
      if (isNativeHookGroup(hookScope)) {
        platformHookGroup.push(hookScope);
      }
    }
    return platformHookGroup;
  }
}
