import { validateAndRepairDecoderSettings, validateAndRepairHookSettings } from "../configValidator";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings, HookSettings } from "../frookySettings";
import { InputParam, InputRetTypeSettings, normalizeInputParam, normalizeInputRetTypeSettings } from "./inputDecodableTypes";
import { InputDecoderSettings, InputHookSettings } from "./inputSettings";

/**
 * Objective-C method selector - either a simple method name, a `[method, decoderSettings]` tuple shorthand,
 * or a detailed definition.
 *
 * The `method` is an Objective-C selector, optionally prefixed with `-` (instance method) or `+` (class method),
 * e.g. `-initWithString:` or `+sharedInstance`. Without a prefix, instance and class methods with that selector are hooked.
 *
 * Objective-C has no overloads. The parameter and return types are read from the method's type encoding,
 * so `params` is optional. If declared, `params` covers the explicit arguments only (not `self` and `_cmd`) and overrides the read types.
 * The return type itself is never declared, only how the return value is decoded ({@link InputRetTypeSettings}).
 *
 * @public
 */
export type InputObjcHookNormalized = {
  objcClass: string;
  method: string;
  params?: InputParam[];
  retType?: InputRetTypeSettings;
  hookSettings?: HookSettings;
  decoderSettings?: DecoderSettings;
};

/**
 * @public
 */
export type InputObjcHook = string | [string, DecoderSettings] | InputObjcHookNormalized;

/**
 * Objective-C hook configuration.
 *
 * Extended type for YAML input parsing.
 *
 * The settings are optional here.
 *
 * @public
 */
export interface InputObjcHookCollection {
  objcClass: string;
  hooks: InputObjcHook[];
  hookSettings?: InputHookSettings;
  decoderSettings?: InputDecoderSettings;
}

// Type guard function
export function isObjcHookCollection(hookScopeInput: object): hookScopeInput is InputObjcHookCollection {
  return "objcClass" in hookScopeInput;
}

/**
 * Normalizes a single Objective-C hook definition into its canonical form.
 *
 * Exported so callers (e.g. the objc hook validator) can normalize and validate hooks one at a time,
 * isolating a malformed param declaration on one hook from the rest of the group.
 *
 * @param objcClass - The Objective-C class the hook belongs to, taken from the enclosing hook group.
 * @param method - The raw hook definition: a plain selector, a `[selector, decoderSettings]` tuple, or a detailed declaration.
 * @param hookSettings - The merged hook settings to apply to this hook.
 * @param decoderSettings - The merged decoder settings to apply to this hook's params and return value.
 * @returns The normalized hook.
 * @throws If a param declaration is in an unrecognized format.
 */
export function normalizeObjcHook(
  objcClass: string,
  method: InputObjcHook,
  hookSettings: HookSettings,
  decoderSettings: DecoderSettings,
): InputObjcHookNormalized {
  if (typeof method === "string") {
    return { objcClass, method, hookSettings, decoderSettings };
  }

  if (Array.isArray(method)) {
    const [methodName, methodDecoderSettings] = method;
    return {
      objcClass,
      method: methodName,
      hookSettings,
      decoderSettings: validateAndRepairDecoderSettings({ ...decoderSettings, ...methodDecoderSettings }),
    };
  }

  const mergedHookSettings = method.hookSettings ? validateAndRepairHookSettings({ ...hookSettings, ...method.hookSettings }) : hookSettings;
  const mergedDecoderSettings = method.decoderSettings
    ? validateAndRepairDecoderSettings({ ...decoderSettings, ...method.decoderSettings })
    : decoderSettings;

  return {
    ...method,
    objcClass,
    params: method.params?.map((param: InputParam) => normalizeInputParam(param, mergedDecoderSettings)),
    retType: method.retType ? normalizeInputRetTypeSettings(method.retType, mergedDecoderSettings) : undefined,
    hookSettings: mergedHookSettings,
    decoderSettings: mergedDecoderSettings,
  };
}

/**
 * Merges the hook group's own hook/decoder settings with the given base settings and the hard-coded defaults,
 * repairing any invalid values along the way.
 *
 * @param hookCollection - The input objc hook group whose settings should be merged.
 * @param settings - The base frooky settings to merge on top of the defaults.
 * @returns The merged, repaired hook and decoder settings.
 */
export function mergeObjcHookCollectionSettings(
  hookCollection: InputObjcHookCollection,
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
