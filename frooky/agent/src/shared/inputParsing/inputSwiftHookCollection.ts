import { validateAndRepairDecoderSettings, validateAndRepairHookSettings } from "../configValidator";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings, HookSettings } from "../frookySettings";
import { InputParam, InputRetTypeSettings, normalizeInputParams, normalizeInputRetTypeSettings } from "./inputDecodableTypes";
import { InputDecoderSettings, InputHookSettings } from "./inputSettings";

/**
 * Fields shared by every detailed Swift method hook. The parameter and return types are taken from the
 * demangled symbol of the method.
 *
 * @public
 */
export type InputSwiftMethodHook = {
  /**
   * Base name of the method, e.g. `authenticate`, which hooks every overload. To hook a single overload, add
   * the argument labels as in the Swift documentation, e.g. `authenticate(user:password:)` (`_` for an unlabeled argument).
   */
  method: string;

  /**
   * Parameters of the method, in order, without the implicit `self`. Replace the types taken from the symbol,
   * so the number of parameters must match.
   */
  params?: InputParam[];

  /** Decoder settings for the return value. The return type is taken from the symbol; no type is declared. */
  retType?: InputRetTypeSettings;

  /** Hook settings for this method. Override the collection's settings. */
  hookSettings?: HookSettings;

  /** Decoder settings for this method. Override the collection's settings. */
  decoderSettings?: DecoderSettings;
};

/**
 * Detailed declaration of a hook on a method of a Swift class.
 *
 * @public
 */
export type InputSwiftClassHookNormalized = InputSwiftMethodHook & {
  /** Swift class name. Inherited from the hook collection. */
  swiftClass: string;
};

/**
 * Detailed declaration of a hook on a method of a Swift struct.
 *
 * @public
 */
export type InputSwiftStructHookNormalized = InputSwiftMethodHook & {
  /** Swift struct name. Inherited from the hook collection. */
  swiftStruct: string;
};

/**
 * Detailed declaration of a hook on a method of a Swift enum.
 *
 * @public
 */
export type InputSwiftEnumHookNormalized = InputSwiftMethodHook & {
  /** Swift enum name. Inherited from the hook collection. */
  swiftEnum: string;
};

/**
 * Detailed declaration of a Swift method hook, on a class, struct or enum.
 *
 * @public
 */
export type InputSwiftHookNormalized = InputSwiftClassHookNormalized | InputSwiftStructHookNormalized | InputSwiftEnumHookNormalized;

/**
 * A Swift method hook: a method name, a `[method, decoderSettings]` tuple, or a detailed declaration.
 *
 * @public
 */
export type InputSwiftHook = string | [string, DecoderSettings] | InputSwiftHookNormalized;

/**
 * Fields shared by every Swift hook collection.
 *
 * @public
 */
export interface InputSwiftHookCollectionBase {
  /** Collection kind. Optional in hook files; inferred from `swiftClass`, `swiftStruct` or `swiftEnum`. */
  type: "swift";

  /** Methods to hook. */
  hooks: InputSwiftHook[];

  /** Hook settings for all hooks in this collection. */
  hookSettings?: InputHookSettings;

  /** Decoder settings for all hooks in this collection. */
  decoderSettings?: InputDecoderSettings;
}

/**
 * Collection of hooks on methods of one Swift class.
 *
 * @public
 */
export interface InputSwiftClassHookCollection extends InputSwiftHookCollectionBase {
  /**
   * Name of the class to hook, optionally qualified with its module, e.g. `MyApp.LoginViewModel`. `*` matches
   * any characters of the module qualified name, e.g. `MyApp.*ViewModel`.
   */
  swiftClass: string;
}

/**
 * Collection of hooks on methods of one Swift struct. Struct methods are found by their symbols, so the app's
 * symbols must not be stripped.
 *
 * @public
 */
export interface InputSwiftStructHookCollection extends InputSwiftHookCollectionBase {
  /** Name of the struct to hook, optionally qualified with its module, e.g. `MyApp.Credentials`. `*` works as for `swiftClass`. */
  swiftStruct: string;
}

/**
 * Collection of hooks on methods of one Swift enum. Enum methods are found by their symbols, so the app's
 * symbols must not be stripped.
 *
 * @public
 */
export interface InputSwiftEnumHookCollection extends InputSwiftHookCollectionBase {
  /** Name of the enum to hook, optionally qualified with its module, e.g. `MyApp.LoginState`. `*` works as for `swiftClass`. */
  swiftEnum: string;
}

/**
 * Collection of hooks on methods of one Swift class, struct or enum.
 *
 * @public
 */
export type InputSwiftHookCollection = InputSwiftClassHookCollection | InputSwiftStructHookCollection | InputSwiftEnumHookCollection;

export function isSwiftHookCollection(hookScopeInput: object): hookScopeInput is InputSwiftHookCollection {
  return "swiftClass" in hookScopeInput || "swiftStruct" in hookScopeInput || "swiftEnum" in hookScopeInput;
}

export function isSwiftHookNormalized(hook: object): hook is InputSwiftHookNormalized {
  return isSwiftHookCollection(hook);
}

// The kind of Swift type a hook targets and its name, e.g. `{ swiftClass: "MyApp.LoginViewModel" }`.
export type SwiftOwner = { swiftClass: string } | { swiftStruct: string } | { swiftEnum: string };

export function getSwiftOwner(hook: InputSwiftHookCollection | InputSwiftHookNormalized): SwiftOwner {
  if ("swiftClass" in hook) return { swiftClass: hook.swiftClass };
  if ("swiftStruct" in hook) return { swiftStruct: hook.swiftStruct };
  return { swiftEnum: hook.swiftEnum };
}

// e.g. `MyApp.LoginViewModel`
export function swiftOwnerName(owner: SwiftOwner): string {
  if ("swiftClass" in owner) return owner.swiftClass;
  if ("swiftStruct" in owner) return owner.swiftStruct;
  return owner.swiftEnum;
}

// Normalizes one hook with the merged collection settings. Throws on an invalid param, so validators can
// skip a single hook.
export function normalizeSwiftHook(
  owner: SwiftOwner,
  method: InputSwiftHook,
  hookSettings: HookSettings,
  decoderSettings: DecoderSettings,
): InputSwiftHookNormalized {
  if (typeof method === "string") {
    return { ...owner, method, hookSettings, decoderSettings };
  }

  if (Array.isArray(method)) {
    const [methodName, methodDecoderSettings] = method;
    return {
      ...owner,
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
    ...owner,
    params: method.params ? normalizeInputParams(method.params, mergedDecoderSettings) : undefined,
    retType: method.retType ? normalizeInputRetTypeSettings(method.retType, mergedDecoderSettings) : undefined,
    hookSettings: mergedHookSettings,
    decoderSettings: mergedDecoderSettings,
  };
}

// Merges defaults, file settings and the collection's settings, repairing invalid values.
export function mergeSwiftHookCollectionSettings(
  hookCollection: InputSwiftHookCollection,
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
