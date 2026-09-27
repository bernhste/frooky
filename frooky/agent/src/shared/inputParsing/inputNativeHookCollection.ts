import { validateAndRepairDecoderSettings, validateAndRepairHookSettings } from "../configValidator";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../defaultValues";
import { DecoderSettings, FrookySettings, HookSettings } from "../frookySettings";
import { InputParam, InputRetType, normalizeInputParams, normalizeInputRetType } from "./inputDecodableTypes";
import { InputDecoderSettings, InputHookSettings } from "./inputSettings";

/**
 * Fields shared by every detailed native hook declaration.
 *
 * @public
 */
export interface InputNativeHookBase {
  /** Module that contains the function. Inherited from the hook collection. */
  module: string;

  /** Parameters of the function, in order. */
  params?: InputParam[];

  /** Return type of the function. */
  retType?: InputRetType;

  /** Hook settings for this function. Override the collection's settings. */
  hookSettings?: HookSettings;

  /** Decoder settings for this function. Override the collection's settings. */
  decoderSettings?: DecoderSettings;
}

/**
 * A native function hook located by its exported symbol name.
 *
 * @public
 */
export interface InputNativeSymbolHook extends InputNativeHookBase {
  /** Exported symbol name of the function. */
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
export type InputNativeHookNormalized = InputNativeSymbolHook | InputNativeOffsetHook;

/**
 * A native function hook: a symbol name, a `[symbol, decoderSettings]` tuple, or a detailed declaration.
 *
 * @public
 */
export type InputNativeHook = string | [string, DecoderSettings] | InputNativeHookNormalized;

/**
 * Collection of hooks on functions exported by one native module.
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

// Type guard function
export function isNativeHookCollection(inputHookScope: object): inputHookScope is InputNativeHookCollection {
  return "module" in inputHookScope && !("javaClass" in inputHookScope) && !("objcClass" in inputHookScope);
}

/**
 * Normalizes a single native hook definition into its canonical form.
 *
 * Exported so callers (e.g. the native hook validator) can normalize and validate hooks one at a time,
 * isolating a malformed param/retType declaration on one hook from the rest of the group.
 *
 * @param inputHook - The raw hook definition: a plain symbol string, a `[symbol, decoderSettings]` tuple, or a detailed declaration.
 * @param moduleName - The module the hook belongs to, taken from the enclosing hook group.
 * @param hookSettings - The merged hook settings to apply to this hook.
 * @param decoderSettings - The merged decoder settings to apply to this hook's params/retType.
 * @returns The normalized hook.
 * @throws If a param or retType declaration is in an unrecognized format, the hook doesn't have exactly one of
 *   `symbol` or `offset`, or the `offset` is invalid.
 */
export function normalizeNativeHook(
  inputHook: InputNativeHook,
  moduleName: string,
  hookSettings: HookSettings,
  decoderSettings: DecoderSettings,
): InputNativeHookNormalized {
  if (typeof inputHook === "string") {
    return {
      symbol: inputHook,
      module: moduleName,
      hookSettings: hookSettings,
      decoderSettings: decoderSettings,
    };
  }

  if (Array.isArray(inputHook)) {
    const [symbol, hookDecoderSettings] = inputHook;
    return {
      symbol: symbol,
      module: moduleName,
      hookSettings: hookSettings,
      decoderSettings: validateAndRepairDecoderSettings({ ...decoderSettings, ...hookDecoderSettings }),
    };
  }

  const mergedHookSettings = inputHook.hookSettings ? validateAndRepairHookSettings({ ...hookSettings, ...inputHook.hookSettings }) : hookSettings;
  const mergedDecoderSettings = inputHook.decoderSettings
    ? validateAndRepairDecoderSettings({ ...decoderSettings, ...inputHook.decoderSettings })
    : decoderSettings;

  const hasSymbol = inputHook.symbol !== undefined;
  const hasModuleOffset = inputHook.offset !== undefined;
  if (hasSymbol === hasModuleOffset) {
    throw new Error("A native hook needs exactly one of `symbol` or `offset`.");
  }
  const target = hasSymbol ? { symbol: inputHook.symbol! } : { offset: normalizeModuleOffset(inputHook.offset!) };

  return {
    ...target,
    module: moduleName,
    params: inputHook.params ? normalizeInputParams(inputHook.params, mergedDecoderSettings) : undefined,
    retType: inputHook.retType ? normalizeInputRetType(inputHook.retType, mergedDecoderSettings) : undefined,
    hookSettings: mergedHookSettings,
    decoderSettings: mergedDecoderSettings,
  };
}

/**
 * Normalizes a `offset` to a lowercase hex string such as `"0x1a2b4"`.
 *
 * YAML parses an unquoted `0x1a2b4` into a number, so numbers are accepted as they are. Strings must start
 * with `0x`: without it, `"1234"` could be meant as hex (as disassemblers show addresses) or as decimal.
 *
 * @param offset - The offset as declared in the hook file.
 * @returns The offset as a lowercase `0x`-prefixed hex string.
 * @throws If the offset is negative, not an integer, or a string that is not `0x`-prefixed hex.
 */
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

/**
 * Names a native hook target for log messages: `libfoo.so!open` for a symbol, `libfoo.so+0x1a2b4` for a module offset.
 */
export function describeNativeTarget(module: string, target: { symbol?: string; offset?: string | number }): string {
  if (target.symbol !== undefined) return `${module}!${target.symbol}`;
  const offset = typeof target.offset === "number" ? `0x${target.offset.toString(16)}` : target.offset;
  return `${module}+${offset}`;
}

/**
 * Merges the hook group's own hook/decoder settings with the given base settings and the hard-coded defaults,
 * repairing any invalid values along the way.
 *
 * Exported so callers can obtain the merged settings for a group without normalizing its hooks (which may throw).
 *
 * @param hookCollection - The input native hook group whose settings should be merged.
 * @param settings - The base frooky settings to merge on top of the defaults.
 * @returns The merged, repaired hook and decoder settings.
 */
export function mergeNativeHookCollectionSettings(
  hookCollection: InputNativeHookCollection,
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

/**
 * Normalizes the hook group by merging default decoder and hook settings with optional settings provided on the hook and decoder level,
 *
 * If no settings are set, the default settings will be set.
 *
 * Then each hook, parameter and return types are normalized by using objects such as InputNativeHookNormalized or Param only.
 *
 * @param hookCollection - The input native hook group to normalize.
 * @returns A new `InputNativeHookCollection` with merged settings and normalized hooks.
 */
export function normalizeNativeHookCollection(hookCollection: InputNativeHookCollection, settings: FrookySettings): InputNativeHookCollection {
  const { hookSettings, decoderSettings } = mergeNativeHookCollectionSettings(hookCollection, settings);

  return {
    ...hookCollection,
    hooks: hookCollection.hooks.map((inputHook: InputNativeHook) =>
      normalizeNativeHook(inputHook, hookCollection.module, hookSettings, decoderSettings),
    ),
    hookSettings: hookSettings,
    decoderSettings: decoderSettings,
  };
}
