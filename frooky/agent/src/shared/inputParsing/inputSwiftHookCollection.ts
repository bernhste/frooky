import { validateAndRepairDecoderSettings, validateAndRepairHookSettings } from "../configValidator";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings, HookSettings } from "../frookySettings";
import { InputParam, InputRetTypeSettings, normalizeInputParam, normalizeInputRetTypeSettings } from "./inputDecodableTypes";
import { InputDecoderSettings, InputHookSettings } from "./inputSettings";

/**
 * Swift hook properties shared by classes, structs and enums.
 *
 * The `method` is the base name of the Swift method, e.g. `authenticate`. Swift methods can be overloaded by
 * their argument labels and types, so a plain name hooks every overload. To hook one, add the argument labels
 * like in Swift documentation, e.g. `authenticate(user:password:)` (`_` for an unlabeled argument).
 *
 * The parameter and return types are taken from the demangled symbol of the method, so `params` is optional.
 * If declared, `params` covers the explicit arguments only (not `self`) and overrides the types taken from the symbol.
 * The return type itself is never declared, only how the return value is decoded ({@link InputRetTypeSettings}).
 *
 * @public
 */
export type InputSwiftMethodHook = {
  method: string;
  params?: InputParam[];
  retType?: InputRetTypeSettings;
  hookSettings?: HookSettings;
  decoderSettings?: DecoderSettings;
};

/** @public */
export type InputSwiftClassHookNormalized = InputSwiftMethodHook & { swiftClass: string };
/** @public */
export type InputSwiftStructHookNormalized = InputSwiftMethodHook & { swiftStruct: string };
/** @public */
export type InputSwiftEnumHookNormalized = InputSwiftMethodHook & { swiftEnum: string };

/**
 * Swift method selector of a class, struct or enum. Which one it is, is told by `swiftClass`, `swiftStruct` or `swiftEnum`.
 *
 * @public
 */
export type InputSwiftHookNormalized = InputSwiftClassHookNormalized | InputSwiftStructHookNormalized | InputSwiftEnumHookNormalized;

/**
 * @public
 */
export type InputSwiftHook = string | [string, DecoderSettings] | InputSwiftHookNormalized;

interface InputSwiftHookCollectionBase {
  hooks: InputSwiftHook[];
  hookSettings?: InputHookSettings;
  decoderSettings?: InputDecoderSettings;
}

/**
 * Swift hook configuration for the methods of a class.
 *
 * `swiftClass` is the name of a Swift class, optionally qualified with its module (`MyApp.LoginViewModel`).
 *
 * @public
 */
export interface InputSwiftClassHookCollection extends InputSwiftHookCollectionBase {
  swiftClass: string;
}

/**
 * Swift hook configuration for the methods of a struct, e.g. `MyApp.Credentials`.
 *
 * The bridge does not enumerate the methods of structs, so they are found by their symbol in the module of the struct.
 * That requires the symbols of the app not to be stripped.
 *
 * @public
 */
export interface InputSwiftStructHookCollection extends InputSwiftHookCollectionBase {
  swiftStruct: string;
}

/**
 * Swift hook configuration for the methods of an enum, e.g. `MyApp.LoginState`. Same restrictions as {@link InputSwiftStructHookCollection}.
 *
 * @public
 */
export interface InputSwiftEnumHookCollection extends InputSwiftHookCollectionBase {
  swiftEnum: string;
}

/**
 * Swift hook configuration. Extended type for YAML input parsing.
 *
 * The settings are optional here.
 *
 * @public
 */
export type InputSwiftHookCollection = InputSwiftClassHookCollection | InputSwiftStructHookCollection | InputSwiftEnumHookCollection;

// Type guard functions
export function isSwiftHookCollection(hookScopeInput: object): hookScopeInput is InputSwiftHookCollection {
  return "swiftClass" in hookScopeInput || "swiftStruct" in hookScopeInput || "swiftEnum" in hookScopeInput;
}

export function isSwiftHookNormalized(hook: object): hook is InputSwiftHookNormalized {
  return isSwiftHookCollection(hook);
}

/** Which kind of Swift type a hook targets, and its (optionally module qualified) name. */
export type SwiftOwner = { swiftClass: string } | { swiftStruct: string } | { swiftEnum: string };

export function getSwiftOwner(hook: InputSwiftHookCollection | InputSwiftHookNormalized): SwiftOwner {
  if ("swiftClass" in hook) return { swiftClass: hook.swiftClass };
  if ("swiftStruct" in hook) return { swiftStruct: hook.swiftStruct };
  return { swiftEnum: hook.swiftEnum };
}

/**
 * Normalizes a single Swift hook definition into its canonical form.
 *
 * Exported so callers (e.g. the swift hook validator) can normalize and validate hooks one at a time,
 * isolating a malformed param declaration on one hook from the rest of the group.
 *
 * @param owner - The Swift class, struct or enum the hook belongs to, taken from the enclosing hook group.
 * @param method - The raw hook definition: a plain method name, a `[method, decoderSettings]` tuple, or a detailed declaration.
 * @param hookSettings - The merged hook settings to apply to this hook.
 * @param decoderSettings - The merged decoder settings to apply to this hook's params and return value.
 * @returns The normalized hook.
 * @throws If a param declaration is in an unrecognized format.
 */
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
 * @param hookCollection - The input swift hook group whose settings should be merged.
 * @param settings - The base frooky settings to merge on top of the defaults.
 * @returns The merged, repaired hook and decoder settings.
 */
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
