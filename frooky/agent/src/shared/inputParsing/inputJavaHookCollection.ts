import { validateAndRepairDecoderSettings, validateAndRepairHookSettings } from "../configValidator";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings, HookSettings } from "../frookySettings";
import { InputParam, InputRetTypeSettings, normalizeInputParam, normalizeInputRetTypeSettings } from "./inputDecodableTypes";
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

  /**
   * Decoder settings applied to this overload's return value.
   *
   * The return type itself is never used - it is always resolved from Frida's own Java reflection
   * at hook-registration time. The documented form is a bare decoder settings object (e.g.
   * `{ decoder: "..." }`), but every form {@link InputRetTypeSettings} accepts is allowed, so
   * declaring it the way native hooks do (`retType: type` or `retType: [type, decoderSettings]`)
   * doesn't produce an invalid hook file - the type portion is simply ignored.
   */
  retType?: InputRetTypeSettings;
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
  hookSettings?: HookSettings;
  decoderSettings?: DecoderSettings;
};

/**
 * Java method selector - either a simple method name, a `[method, decoderSettings]` tuple shorthand,
 * or a detailed definition.
 *
 * @public
 */
export type InputJavaHook = string | [string, DecoderSettings] | InputJavaHookNormalized;

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
export interface InputJavaHookCollection {
  type: "java";
  javaClass: string;
  hooks: InputJavaHook[];
  hookSettings?: InputHookSettings;
  decoderSettings?: InputDecoderSettings;
}

// Type guard function
export function isJavaHookScope(hookScopeInput: object): hookScopeInput is InputJavaHookCollection {
  return "javaClass" in hookScopeInput;
}

// will return a JavaOverload for any form of JavaOverloadInput
function normalizeOverload(overload: InputOverload, decoderSettings: DecoderSettings): InputOverload {
  return {
    ...overload,
    params: overload.params.map((param: InputParam) => normalizeInputParam(param, decoderSettings)),
    retType: overload.retType ? normalizeInputRetTypeSettings(overload.retType, decoderSettings) : undefined,
  };
}

/**
 * Normalizes a single java hook definition into its canonical form.
 *
 * Exported so callers (e.g. the android hook validator) can normalize and validate hooks one at a time,
 * isolating a malformed param declaration on one hook from the rest of the group.
 *
 * Note: Java hooks have no top-level `retType` - the return type is always resolved from Frida's
 * own Java reflection at hook-registration time. An overload may still declare a `retType` decoder
 * settings object (see {@link InputOverload.retType}) to control how that return value is decoded.
 *
 * @param javaClass - The java class the hook belongs to, taken from the enclosing hook group.
 * @param method - The raw hook definition: a plain method name, a `[method, decoderSettings]` tuple, or a detailed declaration.
 * @param hookSettings - The merged hook settings to apply to this hook.
 * @param decoderSettings - The merged decoder settings to apply to this hook's overloads.
 * @returns The normalized hook.
 * @throws If an overload's param declaration is in an unrecognized format.
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

  if (Array.isArray(method)) {
    const [methodName, methodDecoderSettings] = method;
    return {
      javaClass: javaClass,
      method: methodName,
      hookSettings: hookSettings,
      decoderSettings: validateAndRepairDecoderSettings({ ...decoderSettings, ...methodDecoderSettings }),
    };
  }

  const mergedHookSettings = method.hookSettings ? validateAndRepairHookSettings({ ...hookSettings, ...method.hookSettings }) : hookSettings;
  const mergedDecoderSettings = method.decoderSettings
    ? validateAndRepairDecoderSettings({ ...decoderSettings, ...method.decoderSettings })
    : decoderSettings;

  return {
    ...method,
    javaClass: javaClass,
    overloads: method.overloads?.map((overload: InputOverload) => normalizeOverload(overload, mergedDecoderSettings)),
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
 * @param hookCollection - The input java hook group whose settings should be merged.
 * @param settings - The base frooky settings to merge on top of the defaults.
 * @returns The merged, repaired hook and decoder settings.
 */
export function mergeJavaHookCollectionSettings(
  hookCollection: InputJavaHookCollection,
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

// normalized hook group
export function normalizeJavaHookCollection(hookCollection: InputJavaHookCollection, settings: FrookySettings): InputJavaHookCollection {
  const { hookSettings, decoderSettings } = mergeJavaHookCollectionSettings(hookCollection, settings);

  return {
    ...hookCollection,
    hooks: hookCollection.hooks.map((hook: InputJavaHook) => normalizeJavaHook(hookCollection.javaClass, hook, hookSettings, decoderSettings)),
    hookSettings: hookSettings,
    decoderSettings: decoderSettings,
  };
}
