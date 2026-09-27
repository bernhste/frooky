import { validateAndRepairDecoderSettings, validateAndRepairHookSettings } from "../configValidator";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings, HookSettings } from "../frookySettings";
import { InputParam, InputRetTypeSettings, normalizeInputParams, normalizeInputRetTypeSettings } from "./inputDecodableTypes";
import { InputDecoderSettings, InputHookSettings } from "./inputSettings";

/**
 * A specific overload of a Java method.
 *
 * @public
 */
export interface InputOverload {
  /**
   * Parameters of the overload, in order. Their types select the overload.
   */
  params: InputParam[];

  /**
   * Decoder settings for the return value. The return type is resolved via reflection; a declared type is ignored.
   */
  retType?: InputRetTypeSettings;
}

/**
 * Detailed declaration of a Java method hook.
 *
 * @public
 */
export type InputJavaHookNormalized = {
  /** Fully qualified class name. Inherited from the hook collection. */
  javaClass: string;

  /** Method name. Use `$init` for constructors. */
  method: string;

  /** Overloads to hook. If omitted, all overloads are hooked. */
  overloads?: InputOverload[];

  /** Hook settings for this method. Override the collection's settings. */
  hookSettings?: HookSettings;

  /** Decoder settings for this method. Override the collection's settings. */
  decoderSettings?: DecoderSettings;
};

/**
 * A Java method hook: a method name, a `[method, decoderSettings]` tuple, or a detailed declaration.
 *
 * @public
 */
export type InputJavaHook = string | [string, DecoderSettings] | InputJavaHookNormalized;

/**
 * Collection of hooks on methods of one Java class.
 *
 * @public
 * @discriminator {type}
 */
export interface InputJavaHookCollection {
  /** Collection kind. Optional in hook files; inferred from `javaClass`. */
  type: "java";

  /** Fully qualified name of the class to hook, e.g. `android.content.Intent`. */
  javaClass: string;

  /** Methods to hook. */
  hooks: InputJavaHook[];

  /** Hook settings for all hooks in this collection. */
  hookSettings?: InputHookSettings;

  /** Decoder settings for all hooks in this collection. */
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
    params: normalizeInputParams(overload.params, decoderSettings),
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
