import { validateAndRepairDecoderSettings, validateAndRepairHookSettings } from "../configValidator";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings, HookSettings } from "../frookySettings";
import { InputParam, InputRetType, normalizeInputParam, normalizeInputRetType } from "./inputDecodableTypes";
import { InputDecoderSettings, InputHookSettings } from "./inputSettings";

export type InputNativeHookNormalized = {
  symbol: string;
  module: string;
  params?: InputParam[];
  retType?: InputRetType;
  hookSettings?: InputHookSettings;
  decoderSettings?: InputDecoderSettings;
};

/**
 * Type describing a native function in an YAML input file.
 *
 * Can be string, or a NativeFrookyFunction with optional properties.
 *
 * @public
 */
export type InputNativeHook = string | InputNativeHookNormalized;

/**
 * Native hook configuration for YAML parsing.
 * Extends {@link InputNativeHookGroup} with a looser `functions` type that accepts
 * both plain symbol names and detailed definitions.
 * *
 * The settings are optional here.
 *
 * @public
 * @discriminator {type}
 */
export interface InputNativeHookGroup {
  type: "native";
  module: string;
  hooks: InputNativeHook[];
  hookSettings?: InputHookSettings;
  decoderSettings?: InputDecoderSettings;
}

// Type guard function
export function isNativeHookGroup(inputHookScope: object): inputHookScope is InputNativeHookGroup {
  return "module" in inputHookScope && !("javaClass" in inputHookScope) && !("objcClass" in inputHookScope);
}

/**
 * Normalizes a single native hook definition into its canonical form.
 *
 * Exported so callers (e.g. the native hook validator) can normalize and validate hooks one at a time,
 * isolating a malformed param/retType declaration on one hook from the rest of the group.
 *
 * @param inputHook - The raw hook definition, either a plain symbol string or a detailed declaration.
 * @param moduleName - The module the hook belongs to, taken from the enclosing hook group.
 * @param hookSettings - The merged hook settings to apply to this hook.
 * @param decoderSettings - The merged decoder settings to apply to this hook's params/retType.
 * @returns The normalized hook.
 * @throws If a param or retType declaration is in an unrecognized format.
 */
export function normalizeNativeHook(
  inputHook: InputNativeHook,
  moduleName: string,
  hookSettings: HookSettings,
  decoderSettings: DecoderSettings,
): InputNativeHookNormalized {
  if (typeof inputHook === "string") {
    return {
      symbol: inputHook,
      module: moduleName,
      hookSettings: hookSettings,
      decoderSettings: decoderSettings,
    };
  }

  const mergedHookSettings = inputHook.hookSettings
    ? validateAndRepairHookSettings({ ...hookSettings, ...inputHook.hookSettings })
    : hookSettings;
  const mergedDecoderSettings = inputHook.decoderSettings
    ? validateAndRepairDecoderSettings({ ...decoderSettings, ...inputHook.decoderSettings })
    : decoderSettings;

  return {
    symbol: inputHook.symbol,
    module: moduleName,
    params: inputHook.params?.map((paramInput: InputParam) => normalizeInputParam(paramInput, mergedDecoderSettings)),
    retType: inputHook.retType ? normalizeInputRetType(inputHook.retType, mergedDecoderSettings) : undefined,
    hookSettings: mergedHookSettings,
    decoderSettings: mergedDecoderSettings,
  };
}

/**
 * Merges the hook group's own hook/decoder settings with the given base settings and the hard-coded defaults,
 * repairing any invalid values along the way.
 *
 * Exported so callers can obtain the merged settings for a group without normalizing its hooks (which may throw).
 *
 * @param hookGroup - The input native hook group whose settings should be merged.
 * @param settings - The base frooky settings to merge on top of the defaults.
 * @returns The merged, repaired hook and decoder settings.
 */
export function mergeNativeHookGroupSettings(hookGroup: InputNativeHookGroup, settings: FrookySettings): { hookSettings: HookSettings; decoderSettings: DecoderSettings } {
  const hookSettings: HookSettings = validateAndRepairHookSettings({
    ...DEFAULT_HOOK_SETTINGS,
    ...settings.hookSettings,
    ...hookGroup.hookSettings,
  });
  const decoderSettings: DecoderSettings = validateAndRepairDecoderSettings({
    ...DEFAULT_DECODER_SETTINGS,
    ...settings.decoderSettings,
    ...hookGroup.decoderSettings,
  });
  return { hookSettings, decoderSettings };
}

/**
 * Normalizes the hook group by merging default decoder and hook settings with optional settings provided on the hook and decoder level,
 *
 * If no settings are set, the default settings will be set.
 *
 * Then each hook, parameter and return types are normalized by using objects such as InputNativeHookNormalized or Param only.
 *
 * @param hookGroup - The input native hook group to normalize.
 * @returns A new `InputNativeHookGroup` with merged settings and normalized hooks.
 */
export function normalizeNativeHookGroup(hookGroup: InputNativeHookGroup, settings: FrookySettings): InputNativeHookGroup {
  const { hookSettings, decoderSettings } = mergeNativeHookGroupSettings(hookGroup, settings);

  return {
    ...hookGroup,
    hooks: hookGroup.hooks.map((inputHook: InputNativeHook) => normalizeNativeHook(inputHook, hookGroup.module, hookSettings, decoderSettings)),
    hookSettings: hookSettings,
    decoderSettings: decoderSettings,
  };
}
