import { validateAndRepairDecoderSettings, validateAndRepairHookSettings } from "../configValidator";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings, HookSettings } from "../frookySettings";
import { InputParam, InputRetTypeSettings, normalizeInputParams, normalizeInputRetTypeSettings } from "./inputDecodableTypes";
import { InputDecoderSettings, InputHookSettings } from "./inputSettings";

/**
 * Detailed declaration of an Objective-C method hook. Objective-C has no overloads, and the parameter and
 * return types are read from the method's type encoding.
 *
 * @public
 */
export type InputObjcHookNormalized = {
  /** Objective-C class name. Inherited from the hook collection. */
  objcClass: string;

  /**
   * Selector, optionally prefixed with `-` (instance method) or `+` (class method), e.g. `-initWithString:`.
   * Without a prefix, both the instance and the class method with that selector are hooked.
   */
  method: string;

  /**
   * Parameters of the method, in order, without the implicit `self` and `_cmd`. Replace the types read from
   * the type encoding, so the number of parameters must match.
   */
  params?: InputParam[];

  /** Decoder settings for the return value. The return type is read from the type encoding; no type is declared. */
  retType?: InputRetTypeSettings;

  /** Hook settings for this method. Override the collection's settings. */
  hookSettings?: HookSettings;

  /** Decoder settings for this method. Override the collection's settings. */
  decoderSettings?: DecoderSettings;
};

/**
 * An Objective-C method hook: a selector, a `[selector, decoderSettings]` tuple, or a detailed declaration.
 *
 * @public
 */
export type InputObjcHook = string | [string, DecoderSettings] | InputObjcHookNormalized;

/**
 * Collection of hooks on methods of one Objective-C class.
 *
 * @public
 * @discriminator {type}
 */
export interface InputObjcHookCollection {
  /** Collection kind. Optional in hook files; inferred from `objcClass`. */
  type: "objc";

  /**
   * Name of the class to hook, e.g. `NSURLSession`. `*` matches any characters, e.g. `NS*URL*` hooks every
   * loaded class matching the pattern.
   */
  objcClass: string;

  /** Methods to hook. Only methods the class implements itself are hooked, not inherited ones. */
  hooks: InputObjcHook[];

  /** Hook settings for all hooks in this collection. */
  hookSettings?: InputHookSettings;

  /** Decoder settings for all hooks in this collection. */
  decoderSettings?: InputDecoderSettings;
}

export function isObjcHookCollection(hookScopeInput: object): hookScopeInput is InputObjcHookCollection {
  return "objcClass" in hookScopeInput;
}

// Normalizes one hook with the merged collection settings. Throws on an invalid param, so validators can
// skip a single hook.
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
    params: method.params ? normalizeInputParams(method.params, mergedDecoderSettings) : undefined,
    retType: method.retType ? normalizeInputRetTypeSettings(method.retType, mergedDecoderSettings) : undefined,
    hookSettings: mergedHookSettings,
    decoderSettings: mergedDecoderSettings,
  };
}

// Merges defaults, file settings and the collection's settings, repairing invalid values.
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
