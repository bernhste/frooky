import { validateAndRepairDecoderSettings, validateAndRepairHookSettings } from "../configValidator";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings, HookSettings } from "../frookySettings";
import { InputParam, InputRetType, normalizeInputParam, normalizeInputRetType } from "./inputDecodableTypes";
import { InputDecoderSettings, InputHookSettings } from "./inputSettings";

/**
 * Describes a specific Java method overload.
 * Extended type for YAML input parsing.
 * @public
 */
export interface InputOverload {
  /**
   * Parameter type for this overload.
   */
  params: InputParam[];
}

/**
 * Java method selector - either a simple method name or a detailed definition.
 *
 * @public
 */
export type InputJavaHookNormalized = {
  javaClass: string;
  method: string;
  overloads?: InputOverload[];
  retType?: InputRetType;
  hookSettings?: HookSettings;
  decoderSettings?: DecoderSettings;
};

/**
 * Java method selector - either a simple method name or a detailed definition.
 *
 * @public
 */
export type InputJavaHook = string | InputJavaHookNormalized;

/**
 * Native hook configuration.
 *
 * Extended type for YAML input parsing.
 *
 * The settings are optional here.
 *
 * @public
 * @discriminator {type}
 */
export interface InputJavaHookGroup {
  type: "java";
  javaClass: string;
  hooks: InputJavaHook[];
  hookSettings?: InputHookSettings;
  decoderSettings?: InputDecoderSettings;
}

// Type guard function
export function isJavaHookScope(hookScopeInput: object): hookScopeInput is InputJavaHookGroup {
  return "javaClass" in hookScopeInput;
}

// will return a JavaOverload for any form of JavaOverloadInput
function normalizeOverload(overload: InputOverload, decoderSettings: DecoderSettings): InputOverload {
  return {
    ...overload,
    params: overload.params.map((param: InputParam) => normalizeInputParam(param, decoderSettings)),
  };
}

/**
 * Normalizes a single java hook definition into its canonical form.
 *
 * Exported so callers (e.g. the android hook validator) can normalize and validate hooks one at a time,
 * isolating a malformed param/retType declaration on one hook from the rest of the group.
 *
 * @param javaClass - The java class the hook belongs to, taken from the enclosing hook group.
 * @param method - The raw hook definition, either a plain method name or a detailed declaration.
 * @param hookSettings - The merged hook settings to apply to this hook.
 * @param decoderSettings - The merged decoder settings to apply to this hook's overloads/retType.
 * @returns The normalized hook.
 * @throws If an overload's param or a retType declaration is in an unrecognized format.
 */
export function normalizeJavaHook(
  javaClass: string,
  method: InputJavaHook,
  hookSettings: HookSettings,
  decoderSettings: DecoderSettings,
): InputJavaHookNormalized {
  if (typeof method === "string") {
    return { javaClass: javaClass, method: method, hookSettings: hookSettings, decoderSettings: decoderSettings };
  }

  return {
    ...method,
    javaClass: javaClass,
    overloads: method.overloads?.map((overload: InputOverload) => normalizeOverload(overload, decoderSettings)),
    retType: method.retType ? normalizeInputRetType(method.retType, decoderSettings) : undefined,
    hookSettings: hookSettings,
    decoderSettings: decoderSettings,
  };
}

/**
 * Merges the hook group's own hook/decoder settings with the given base settings and the hard-coded defaults,
 * repairing any invalid values along the way.
 *
 * Exported so callers can obtain the merged settings for a group without normalizing its hooks (which may throw).
 *
 * @param hookGroup - The input java hook group whose settings should be merged.
 * @param settings - The base frooky settings to merge on top of the defaults.
 * @returns The merged, repaired hook and decoder settings.
 */
export function mergeJavaHookGroupSettings(hookGroup: InputJavaHookGroup, settings: FrookySettings): { hookSettings: HookSettings; decoderSettings: DecoderSettings } {
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

// normalized hook group
export function normalizeJavaHookGroup(hookGroup: InputJavaHookGroup, settings: FrookySettings): InputJavaHookGroup {
  const { hookSettings, decoderSettings } = mergeJavaHookGroupSettings(hookGroup, settings);

  return {
    ...hookGroup,
    hooks: hookGroup.hooks.map((hook: InputJavaHook) => normalizeJavaHook(hookGroup.javaClass, hook, hookSettings, decoderSettings)),
    hookSettings: hookSettings,
    decoderSettings: decoderSettings,
  };
}
