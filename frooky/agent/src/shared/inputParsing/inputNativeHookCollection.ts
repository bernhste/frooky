import { validateAndRepairDecoderSettings, validateAndRepairHookSettings } from "../configValidator";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings, HookSettings } from "../frookySettings";
import { InputParam, InputRetType, normalizeInputParams, normalizeInputRetType } from "./inputDecodableTypes";
import { InputDecoderSettings, InputHookSettings } from "./inputSettings";

/**
 * Detailed declaration of a native function hook.
 *
 * @public
 */
export type InputNativeHookNormalized = {
  /** Exported symbol name of the function. */
  symbol: string;

  /** Module that exports the symbol. Inherited from the hook collection. */
  module: string;

  /** Parameters of the function, in order. */
  params?: InputParam[];

  /** Return type of the function. */
  retType?: InputRetType;

  /** Hook settings for this function. Override the collection's settings. */
  hookSettings?: HookSettings;

  /** Decoder settings for this function. Override the collection's settings. */
  decoderSettings?: DecoderSettings;
};

/**
 * A native function hook: a symbol name, a `[symbol, decoderSettings]` tuple, or a detailed declaration.
 *
 * @public
 */
export type InputNativeHook = string | [string, DecoderSettings] | InputNativeHookNormalized;

/**
 * Collection of hooks on functions exported by one native module.
 *
 * @public
 * @discriminator {type}
 */
export interface InputNativeHookCollection {
  /** Collection kind. Optional in hook files; inferred from `module`. */
  type: "native";

  /** Name of the module that exports the functions, e.g. `libssl.so`. */
  module: string;

  /** Functions to hook. */
  hooks: InputNativeHook[];

  /** Hook settings for all hooks in this collection. */
  hookSettings?: InputHookSettings;

  /** Decoder settings for all hooks in this collection. */
  decoderSettings?: InputDecoderSettings;
}

// Type guard function
export function isNativeHookCollection(inputHookScope: object): inputHookScope is InputNativeHookCollection {
  return "module" in inputHookScope && !("javaClass" in inputHookScope) && !("objcClass" in inputHookScope);
}

/**
 * Normalizes a single native hook definition into its canonical form.
 *
 * Exported so callers (e.g. the native hook validator) can normalize and validate hooks one at a time,
 * isolating a malformed param/retType declaration on one hook from the rest of the group.
 *
 * @param inputHook - The raw hook definition: a plain symbol string, a `[symbol, decoderSettings]` tuple, or a detailed declaration.
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

  if (Array.isArray(inputHook)) {
    const [symbol, hookDecoderSettings] = inputHook;
    return {
      symbol: symbol,
      module: moduleName,
      hookSettings: hookSettings,
      decoderSettings: validateAndRepairDecoderSettings({ ...decoderSettings, ...hookDecoderSettings }),
    };
  }

  const mergedHookSettings = inputHook.hookSettings ? validateAndRepairHookSettings({ ...hookSettings, ...inputHook.hookSettings }) : hookSettings;
  const mergedDecoderSettings = inputHook.decoderSettings
    ? validateAndRepairDecoderSettings({ ...decoderSettings, ...inputHook.decoderSettings })
    : decoderSettings;

  return {
    symbol: inputHook.symbol,
    module: moduleName,
    params: inputHook.params ? normalizeInputParams(inputHook.params, mergedDecoderSettings) : undefined,
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
 * @param hookCollection - The input native hook group whose settings should be merged.
 * @param settings - The base frooky settings to merge on top of the defaults.
 * @returns The merged, repaired hook and decoder settings.
 */
export function mergeNativeHookCollectionSettings(
  hookCollection: InputNativeHookCollection,
  settings: FrookySettings,
): { hookSettings: HookSettings; decoderSettings: DecoderSettings } {
  const hookSettings: HookSettings = validateAndRepairHookSettings({
    ...DEFAULT_HOOK_SETTINGS,
    ...settings.hookSettings,
    ...hookCollection.hookSettings,
  });
  const decoderSettings: DecoderSettings = validateAndRepairDecoderSettings({
    ...DEFAULT_DECODER_SETTINGS,
    ...settings.decoderSettings,
    ...hookCollection.decoderSettings,
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
 * @param hookCollection - The input native hook group to normalize.
 * @returns A new `InputNativeHookCollection` with merged settings and normalized hooks.
 */
export function normalizeNativeHookCollection(hookCollection: InputNativeHookCollection, settings: FrookySettings): InputNativeHookCollection {
  const { hookSettings, decoderSettings } = mergeNativeHookCollectionSettings(hookCollection, settings);

  return {
    ...hookCollection,
    hooks: hookCollection.hooks.map((inputHook: InputNativeHook) =>
      normalizeNativeHook(inputHook, hookCollection.module, hookSettings, decoderSettings),
    ),
    hookSettings: hookSettings,
    decoderSettings: decoderSettings,
  };
}
