import { validateAndRepairDecoderSettings, validateAndRepairHookSettings } from "../configValidator";
import { DEFAULT_BASE_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { BaseDecoderSettings, FrookySettings, HookSettings } from "../frookySettings";
import { RETURN_VALUE_DECODER_ARG } from "../decoders/decoderArgs";
import { NativeHookDeclaration } from "../hook/hookDeclaration";
import { InputParam, InputRetType, normalizeInputParams, normalizeInputRetType } from "./inputDecodableTypes";
import { InputDecoderSettings, InputHookSettings } from "./inputSettings";

/**
 * Fields shared by every detailed native hook declaration.
 *
 * @public
 */
export interface InputNativeHookBase {
  /** Parameters of the function, in order. */
  params?: InputParam[];

  /** Return type of the function. */
  retType?: InputRetType;

  /** Hook settings for this function. Override the collection's settings. */
  hookSettings?: InputHookSettings;

  /** Decoder settings for this function. Override the collection's settings. */
  decoderSettings?: InputDecoderSettings;
}

/**
 * A native function hook located by its exported symbol name.
 *
 * @public
 */
export interface InputNativeSymbolHook extends InputNativeHookBase {
  /**
   * Exported symbol name of the function. A `*` matches any characters, e.g. `SSL_*` hooks every exported function of
   * the module whose name starts with `SSL_`.
   */
  symbol: string;

  /** Not allowed together with `symbol`. */
  offset?: never;
}

/**
 * A native function hook located by its offset from the module's base address, for functions without an exported symbol.
 *
 * @public
 */
export interface InputNativeOffsetHook extends InputNativeHookBase {
  /**
   * Offset of the function from the module's base address, e.g. `0x1a2b4`: the address shown by a disassembler
   * minus the image base it loaded the module at. A YAML number, or a string starting with `0x`.
   */
  offset: string | number;

  /** Not allowed together with `offset`. */
  symbol?: never;
}

/**
 * Detailed declaration of a native function hook, located either by `symbol` or by `offset`.
 *
 * @public
 */
export type InputNativeHookDetails = InputNativeSymbolHook | InputNativeOffsetHook;

/**
 * A native function hook: a symbol name, a `[symbol, decoderSettings]` tuple, or a detailed declaration. A `*` in the
 * symbol name matches any characters.
 *
 * @public
 */
export type InputNativeHook = string | [string, InputDecoderSettings] | InputNativeHookDetails;

/**
 * Collection of hooks on functions of one native module.
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

export function isNativeHookCollection(inputHookScope: object): inputHookScope is InputNativeHookCollection {
  return "module" in inputHookScope && !("javaClass" in inputHookScope) && !("objcClass" in inputHookScope);
}

// Normalizes one hook, validated against the input schema, with the merged collection settings. Throws on an invalid
// param, retType or offset, so validators can skip a single hook.
export function normalizeNativeHook(
  inputHook: InputNativeHook,
  module: string,
  hookSettings: HookSettings,
  decoderSettings: BaseDecoderSettings,
): NativeHookDeclaration {
  if (typeof inputHook === "string") {
    return { symbol: inputHook, module, hookSettings, decoderSettings };
  }

  if (Array.isArray(inputHook)) {
    const [symbol, hookDecoderSettings] = inputHook;
    return { symbol, module, hookSettings, decoderSettings: validateAndRepairDecoderSettings({ ...decoderSettings, ...hookDecoderSettings }) };
  }

  const mergedHookSettings = inputHook.hookSettings ? validateAndRepairHookSettings({ ...hookSettings, ...inputHook.hookSettings }) : hookSettings;
  const mergedDecoderSettings = inputHook.decoderSettings
    ? validateAndRepairDecoderSettings({ ...decoderSettings, ...inputHook.decoderSettings })
    : decoderSettings;

  const target = inputHook.symbol !== undefined ? { symbol: inputHook.symbol } : { offset: normalizeModuleOffset(inputHook.offset) };
  const params = inputHook.params && normalizeInputParams(inputHook.params, mergedDecoderSettings);
  const retType = inputHook.retType && normalizeInputRetType(inputHook.retType, mergedDecoderSettings);
  // Java hooks know their return type by reflection, a native hook only from its declaration
  if (!retType && params?.some((param) => Object.values(param.settings.decoderArgs ?? {}).includes(RETURN_VALUE_DECODER_ARG))) {
    throw new Error(`decoderArgs: '${RETURN_VALUE_DECODER_ARG}' needs the hook to declare a 'retType', to decode the return value.`);
  }

  return {
    ...target,
    module,
    ...(params && { params }),
    ...(retType && { retType }),
    hookSettings: mergedHookSettings,
    decoderSettings: mergedDecoderSettings,
  };
}

// e.g. `0x1A2B4` or 107188 -> `"0x1a2b4"`. YAML parses unquoted `0x1a2b4` as a number. Strings need `0x`, since
// `"1234"` could be meant as hex or decimal.
export function normalizeModuleOffset(offset: string | number): string {
  if (typeof offset === "number") {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error(`Invalid offset ${offset}: must be a non-negative integer.`);
    }
    return `0x${offset.toString(16)}`;
  }
  const match = /^0x([0-9a-f]+)$/i.exec(offset.trim());
  if (!match) {
    throw new Error(`Invalid offset "${offset}": must be a hex number starting with 0x, e.g. 0x1a2b4.`);
  }
  // drop leading zeros, which disassemblers often print (e.g. IDA's 000000000001A2B4)
  return `0x${match[1].replace(/^0+(?=.)/, "").toLowerCase()}`;
}

// e.g. `libfoo.so!open` or `libfoo.so+0x1a2b4`
export function describeNativeTarget(module: string, target: { symbol?: string; offset?: string | number }): string {
  if (target.symbol !== undefined) return `${module}!${target.symbol}`;
  const offset = typeof target.offset === "number" ? `0x${target.offset.toString(16)}` : target.offset;
  return `${module}+${offset}`;
}

// Merges defaults, file settings and the collection's settings, repairing invalid values.
export function mergeNativeHookCollectionSettings(
  hookCollection: InputNativeHookCollection,
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
export function normalizeNativeHookCollection(
  hookCollection: InputNativeHookCollection,
  settings: FrookySettings,
): Omit<InputNativeHookCollection, "hooks"> & {
  hooks: NativeHookDeclaration[];
  hookSettings: HookSettings;
  decoderSettings: BaseDecoderSettings;
} {
  const { hookSettings, decoderSettings } = mergeNativeHookCollectionSettings(hookCollection, settings);
  return {
    ...hookCollection,
    hooks: hookCollection.hooks.map((inputHook) => normalizeNativeHook(inputHook, hookCollection.module, hookSettings, decoderSettings)),
    hookSettings,
    decoderSettings,
  };
}
