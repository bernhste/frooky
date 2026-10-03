import { acceptedJavaDecoderArgs, javaDecoderNames } from "../decoders/javaDecoderResolver";
import z from "zod";
import { validateInputHook } from "../../shared/configValidator";
import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { JavaHookDeclaration } from "../../shared/hook/hookDeclaration";
import { HookValidator } from "../../shared/hook/hookValidator";
import { validateDecoderArgRoles, validateDecoderNames } from "../../shared/inputParsing/inputDecodableTypes";
import {
  InputJavaHookCollection,
  isJavaHookScope,
  mergeJavaHookCollectionSettings,
  normalizeJavaHook,
} from "../../shared/inputParsing/inputJavaHookCollection";
import { inputJavaHookSchema } from "../../shared/inputParsing/zodSchemas/inputJavaHookCollection.zod";
import { logger } from "../../shared/logger";

export class AndroidHookValidator implements HookValidator<JavaHookDeclaration, InputJavaHookCollection> {
  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): JavaHookDeclaration[] {
    const javaHookCollections = this.getPlatformHookCollections(inputFrookyConfig);
    const normalizedJavaHooks: JavaHookDeclaration[] = [];

    for (const javaHookCollection of javaHookCollections) {
      const { hookSettings, decoderSettings } = mergeJavaHookCollectionSettings(javaHookCollection, settings);
      for (const inputJavaHook of javaHookCollection.hooks) {
        const method = describeJavaMethod(inputJavaHook);
        try {
          const validInputHook = validateInputHook(
            inputJavaHookSchema,
            inputJavaHook,
            `java method '${method}' from class '${javaHookCollection.javaClass}'`,
          );
          const normalizedJavaHook = normalizeJavaHook(
            javaHookCollection.javaClass,
            validInputHook,
            hookSettings,
            decoderSettings,
            javaHookCollection.classLoader,
          );
          const overloads = normalizedJavaHook.overloads ?? [];
          overloads.forEach((overload) => validateDecoderArgRoles(overload.params, acceptedJavaDecoderArgs));
          validateDecoderNames(
            [normalizedJavaHook.decoderSettings, ...overloads.flatMap((overload) => [overload.retType, ...overload.params.map((p) => p.settings)])],
            javaDecoderNames(),
            "Java",
          );
          if (normalizedJavaHook.hookSettings.early) {
            logger.warn(
              `Early hooking ('early: true') is not supported for Java method '${normalizedJavaHook.method}' from class '${javaHookCollection.javaClass}' because Java hooks require the Android runtime (ART) to be initialized.`,
            );
            normalizedJavaHook.hookSettings = { ...normalizedJavaHook.hookSettings, early: false };
          }
          normalizedJavaHooks.push(normalizedJavaHook);
        } catch (e) {
          const validationError = e instanceof z.ZodError ? z.prettifyError(e) : String(e instanceof Error ? e.message : e);
          logger.warn(
            `Skipping hook for java method '${method}' from class '${javaHookCollection.javaClass}' due to an invalid declaration:\n${validationError}`,
          );
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

// The method name of a hook declaration that may not be valid yet, for messages.
function describeJavaMethod(inputHook: unknown): string {
  if (typeof inputHook === "string") return inputHook;
  if (Array.isArray(inputHook)) return String(inputHook[0]);
  return String((inputHook as { method?: unknown } | null)?.method);
}
