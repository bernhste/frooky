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
   * Decoder settings for the return value. The return type is resolved via reflection; no type is declared.
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

  /** Custom class loader to look the class up in. Inherited from the hook collection. */
  classLoader?: string;

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

  /**
   * Fully qualified name of a custom `ClassLoader` subclass, e.g. `com.example.PluginLoader`. The class is then only
   * hooked as loaded by instances of this class loader, also when one of them loads it later. Only needed for a class
   * loader that doesn't extend `BaseDexClassLoader` (e.g. one that defines classes with `DexFile.loadClass()`), or to
   * hook a class that also exists in another class loader.
   */
  classLoader?: string;

  /** Methods to hook. */
  hooks: InputJavaHook[];

  /** Hook settings for all hooks in this collection. */
  hookSettings?: InputHookSettings;

  /** Decoder settings for all hooks in this collection. */
  decoderSettings?: InputDecoderSettings;
}

export function isJavaHookScope(hookScopeInput: object): hookScopeInput is InputJavaHookCollection {
  return "javaClass" in hookScopeInput;
}

function normalizeOverload(overload: InputOverload, decoderSettings: DecoderSettings): InputOverload {
  return {
    ...overload,
    params: normalizeInputParams(overload.params, decoderSettings),
    retType: overload.retType ? normalizeInputRetTypeSettings(overload.retType, decoderSettings) : undefined,
  };
}

// Normalizes one hook with the merged collection settings. Throws on an invalid param, so validators can
// skip a single hook.
export function normalizeJavaHook(
  javaClass: string,
  method: InputJavaHook,
  hookSettings: HookSettings,
  decoderSettings: DecoderSettings,
  classLoader?: string,
): InputJavaHookNormalized {
  const inherited = classLoader === undefined ? { javaClass } : { javaClass, classLoader };
  if (typeof method === "string") {
    return { ...inherited, method: method, hookSettings: hookSettings, decoderSettings: decoderSettings };
  }

  if (Array.isArray(method)) {
    const [methodName, methodDecoderSettings] = method;
    return {
      ...inherited,
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
    ...inherited,
    overloads: method.overloads?.map((overload: InputOverload) => normalizeOverload(overload, mergedDecoderSettings)),
    hookSettings: mergedHookSettings,
    decoderSettings: mergedDecoderSettings,
  };
}

// Merges defaults, file settings and the collection's settings, repairing invalid values.
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

export function normalizeJavaHookCollection(hookCollection: InputJavaHookCollection, settings: FrookySettings): InputJavaHookCollection {
  const { hookSettings, decoderSettings } = mergeJavaHookCollectionSettings(hookCollection, settings);

  return {
    ...hookCollection,
    hooks: hookCollection.hooks.map((hook: InputJavaHook) =>
      normalizeJavaHook(hookCollection.javaClass, hook, hookSettings, decoderSettings, hookCollection.classLoader),
    ),
    hookSettings: hookSettings,
    decoderSettings: decoderSettings,
  };
}
