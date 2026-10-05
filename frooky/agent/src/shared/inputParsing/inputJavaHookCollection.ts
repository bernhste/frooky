import { validateAndRepairDecoderSettings, validateAndRepairHookSettings } from "../configValidator";
import { DEFAULT_BASE_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { BaseDecoderSettings, FrookySettings, HookSettings } from "../frookySettings";
import { JavaHookDeclaration, JavaOverloadDeclaration } from "../hook/hookDeclaration";
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
export interface InputJavaHookDetails {
  /**
   * Method name. Use `$init` for constructors. A `*` matches any characters, e.g. `get*` hooks every method of the
   * class whose name starts with `get`, but no inherited method and no constructor.
   */
  method: string;

  /** Overloads to hook. If omitted, all overloads are hooked. */
  overloads?: InputOverload[];

  /** Hook settings for this method. Override the collection's settings. */
  hookSettings?: InputHookSettings;

  /** Decoder settings for this method. Override the collection's settings. */
  decoderSettings?: InputDecoderSettings;
}

/**
 * A Java method hook: a method name, a `[method, decoderSettings]` tuple, or a detailed declaration. A `*` in the
 * method name matches any characters.
 *
 * @public
 */
export type InputJavaHook = string | [string, InputDecoderSettings] | InputJavaHookDetails;

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

function normalizeOverload(overload: InputOverload, decoderSettings: BaseDecoderSettings): JavaOverloadDeclaration {
  return {
    params: normalizeInputParams(overload.params, decoderSettings),
    ...(overload.retType && { retType: normalizeInputRetTypeSettings(overload.retType, decoderSettings) }),
  };
}

// Normalizes one hook, validated against the input schema, with the merged collection settings. Throws on an invalid
// param, so validators can skip a single hook.
export function normalizeJavaHook(
  javaClass: string,
  inputHook: InputJavaHook,
  hookSettings: HookSettings,
  decoderSettings: BaseDecoderSettings,
  classLoader?: string,
): JavaHookDeclaration {
  const inherited = classLoader === undefined ? { javaClass } : { javaClass, classLoader };
  if (typeof inputHook === "string") {
    return { ...inherited, method: inputHook, hookSettings, decoderSettings };
  }

  if (Array.isArray(inputHook)) {
    const [method, methodDecoderSettings] = inputHook;
    return {
      ...inherited,
      method,
      hookSettings,
      decoderSettings: validateAndRepairDecoderSettings({ ...decoderSettings, ...methodDecoderSettings }),
    };
  }

  const mergedHookSettings = inputHook.hookSettings ? validateAndRepairHookSettings({ ...hookSettings, ...inputHook.hookSettings }) : hookSettings;
  const mergedDecoderSettings = inputHook.decoderSettings
    ? validateAndRepairDecoderSettings({ ...decoderSettings, ...inputHook.decoderSettings })
    : decoderSettings;

  return {
    ...inherited,
    method: inputHook.method,
    ...(inputHook.overloads && { overloads: inputHook.overloads.map((overload) => normalizeOverload(overload, mergedDecoderSettings)) }),
    hookSettings: mergedHookSettings,
    decoderSettings: mergedDecoderSettings,
  };
}

// Merges defaults, file settings and the collection's settings, repairing invalid values.
export function mergeJavaHookCollectionSettings(
  hookCollection: InputJavaHookCollection,
  settings: FrookySettings,
): { hookSettings: HookSettings; decoderSettings: BaseDecoderSettings } {
  const hookSettings: HookSettings = validateAndRepairHookSettings({
    ...DEFAULT_HOOK_SETTINGS,
    ...settings.hookSettings,
    ...hookCollection.hookSettings,
  });
  const decoderSettings: BaseDecoderSettings = validateAndRepairDecoderSettings({
    ...DEFAULT_BASE_DECODER_SETTINGS,
    ...settings.decoderSettings,
    ...hookCollection.decoderSettings,
  });
  return { hookSettings, decoderSettings };
}

// The collection with its merged settings and its hooks normalized
export function normalizeJavaHookCollection(
  hookCollection: InputJavaHookCollection,
  settings: FrookySettings,
): Omit<InputJavaHookCollection, "hooks"> & { hooks: JavaHookDeclaration[]; hookSettings: HookSettings; decoderSettings: BaseDecoderSettings } {
  const { hookSettings, decoderSettings } = mergeJavaHookCollectionSettings(hookCollection, settings);
  return {
    ...hookCollection,
    hooks: hookCollection.hooks.map((hook) =>
      normalizeJavaHook(hookCollection.javaClass, hook, hookSettings, decoderSettings, hookCollection.classLoader),
    ),
    hookSettings,
    decoderSettings,
  };
}
