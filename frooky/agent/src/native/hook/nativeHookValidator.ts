import { Param, RetType } from "../../shared/decoders/decodable";
import z from "zod";

import { InputFrookyConfig } from "../../shared/frookyConfig";
import { FrookySettings } from "../../shared/frookySettings";
import { HookValidator } from "../../shared/hook/hookValidator";
import {
  InputNativeHookCollection,
  InputNativeHookNormalized,
  isNativeHookCollection,
  mergeNativeHookCollectionSettings,
  normalizeNativeHook,
} from "../../shared/inputParsing/inputNativeHookCollection";
import { inputNativeHookNormalizedSchema } from "../../shared/inputParsing/zodSchemas/inputNativeHookCollection.zod";
import { logger } from "../../shared/logger";
import { validateDecoderArgRoles, validateDecoderNames } from "../../shared/inputParsing/inputDecodableTypes";
import { acceptedNativeDecoderArgs, NATIVE_DECODER_NAMES } from "../decoders/nativeDecoderResolver";

export class NativeHookValidator implements HookValidator<InputNativeHookNormalized, InputNativeHookCollection> {
  validateAndNormalizeHooks(inputFrookyConfig: InputFrookyConfig, settings: FrookySettings): InputNativeHookNormalized[] {
    const nativeHookCollections = this.getPlatformHookCollections(inputFrookyConfig);
    const normalizedNativeHooks: InputNativeHookNormalized[] = [];

    for (const nativeHookCollection of nativeHookCollections) {
      const { hookSettings, decoderSettings } = mergeNativeHookCollectionSettings(nativeHookCollection, settings);
      for (const inputNativeHook of nativeHookCollection.hooks) {
        try {
          const normalizedNativeHook = normalizeNativeHook(inputNativeHook, nativeHookCollection.module, hookSettings, decoderSettings);
          validateDecoderArgRoles(normalizedNativeHook.params as Param[] | undefined, acceptedNativeDecoderArgs);
          validateDecoderNames(
            [
              normalizedNativeHook.decoderSettings,
              (normalizedNativeHook.retType as RetType | undefined)?.settings,
              ...((normalizedNativeHook.params as Param[] | undefined) ?? []).map((p) => p.settings),
            ],
            NATIVE_DECODER_NAMES,
            "native",
          );
          rejectErrnoOnParams(normalizedNativeHook.params as Param[] | undefined);
          normalizedNativeHooks.push(inputNativeHookNormalizedSchema.parse(normalizedNativeHook));
        } catch (e) {
          const symbol =
            typeof inputNativeHook === "string" ? inputNativeHook : Array.isArray(inputNativeHook) ? inputNativeHook[0] : inputNativeHook.symbol;
          const offset = typeof inputNativeHook === "object" && !Array.isArray(inputNativeHook) ? inputNativeHook.offset : undefined;
          const target = symbol !== undefined ? `function '${symbol}'` : offset !== undefined ? `function at offset '${offset}'` : "function";
          const validationError = e instanceof z.ZodError ? z.prettifyError(e) : String(e instanceof Error ? e.message : e);
          logger.warn(
            `Skipping hook for native ${target} from module '${nativeHookCollection.module}' due to an invalid declaration:\n${validationError}`,
          );
        }
      }
    }
    logger.debug(`Normalized Native hook: ${JSON.stringify(normalizedNativeHooks, null, 2)}`);
    return normalizedNativeHooks;
  }

  getPlatformHookCollections(inputFrookyConfig: InputFrookyConfig): InputNativeHookCollection[] {
    const platformHookCollection: InputNativeHookCollection[] = [];
    for (const hookScope of inputFrookyConfig.hookCollection) {
      if (isNativeHookCollection(hookScope)) {
        platformHookCollection.push(hookScope);
      }
    }
    return platformHookCollection;
  }
}

// errno is only set by the call, so `decoder: errno` only applies to the return value
function rejectErrnoOnParams(params: Param[] | undefined): void {
  const param = params?.find((p) => p.settings.decoder === "errno");
  if (param) {
    throw new Error(
      `decoder: errno on '${param.name ?? param.type}' is only supported on the return value, e.g. 'retType: [int, { decoder: errno }]'.`,
    );
  }
}
