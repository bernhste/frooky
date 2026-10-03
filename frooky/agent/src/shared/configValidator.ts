import z from "zod";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_FROOKY_SETTINGS, DEFAULT_HOOK_SETTINGS } from "./defaultValues";
import { InputFrookyConfig } from "./frookyConfig";
import { FrookyMetadata, Platform } from "./frookyMetadata";
import { DecoderSettings, FrookySettings, HookSettings } from "./frookySettings";
import { InputDecoderSettings, InputFrookySettings, InputHookSettings } from "./inputParsing/inputSettings";
import { frookyMetadataSchema } from "./inputParsing/zodSchemas/frookyMetadata.zod";
import { inputDecoderSettingsSchema, inputHookSettingsSchema } from "./inputParsing/zodSchemas/inputSettings.zod";
import { logger } from "./logger";

// Validates the metadata and settings of a config and replaces invalid settings with defaults.
export function validateAndRepairFrookyConfig(frookyConfig: InputFrookyConfig, platform: Platform): InputFrookyConfig {
  logger.debug(`Validating frooky config`);

  if (frookyConfig.metadata) {
    validateMetadata(frookyConfig.metadata, platform);
  }

  if (!frookyConfig.hookCollection) {
    throw Error(`Frooky config ${frookyConfig.metadata?.name ? frookyConfig.metadata?.name : ""}, as it has no 'hookCollection'.`);
  }

  const knownKeys: (keyof InputFrookyConfig)[] = ["metadata", "settings", "hookCollection"];
  const extraKeys = Object.keys(frookyConfig).filter((k) => !knownKeys.includes(k as keyof InputFrookyConfig));
  if (extraKeys.length > 0) {
    logger.warn(`Frooky config contains unknown properties: ${extraKeys.join(", ")}`);
  }

  if (!frookyConfig.settings) {
    frookyConfig.settings = { ...DEFAULT_FROOKY_SETTINGS };
    return frookyConfig;
  } else {
    if (frookyConfig.settings) {
      frookyConfig.settings = validateAndRepairFrookySettings(frookyConfig.settings);
    }
    logger.debug(`Frooky config is valid`);
    return frookyConfig;
  }
}

export function validateAndRepairFrookySettings(inputSettings: InputFrookySettings): FrookySettings {
  logger.debug(`Validating frooky settings`);
  // a copy, the defaults are shared by all configs
  const validFrookySettings: FrookySettings = { ...DEFAULT_FROOKY_SETTINGS };

  if (inputSettings.hookSettings) {
    validFrookySettings.hookSettings = validateAndRepairHookSettings(inputSettings.hookSettings);
  }

  if (inputSettings.decoderSettings) {
    validFrookySettings.decoderSettings = validateAndRepairDecoderSettings(inputSettings.decoderSettings);
  }

  logger.debug(`Frooky settings are valid`);
  return validFrookySettings;
}

// Replaces invalid and missing hook settings with defaults.
export function validateAndRepairHookSettings(settings: InputHookSettings): HookSettings {
  logger.debug(`Validating frooky hook settings`);
  const result = inputHookSettingsSchema.safeParse(settings);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof HookSettings;
      (settings as Record<keyof HookSettings, unknown>)[key] = DEFAULT_HOOK_SETTINGS[key];
      logger.warn(
        `Hook setting "'${key}'" contains invalid data:\n${z.prettifyError(result.error)}\nThe value for '${key}' was reset to the default: ${DEFAULT_HOOK_SETTINGS[key]}`,
      );
    }
  }

  const knownKeys = Object.keys(DEFAULT_HOOK_SETTINGS);
  const extraKeys = Object.keys(settings).filter((k) => !knownKeys.includes(k));
  if (extraKeys.length > 0) {
    logger.warn(`Hook settings contain unknown properties: ${extraKeys.join(", ")}`);
  }

  const validHookSettings: HookSettings = { ...DEFAULT_HOOK_SETTINGS, ...settings };

  // an invalid pattern would throw on every intercepted call
  const invalidPatterns = validHookSettings.callerFilter.filter((pattern) => !isValidRegExp(pattern));
  if (invalidPatterns.length > 0) {
    validHookSettings.callerFilter = validHookSettings.callerFilter.filter((pattern) => !invalidPatterns.includes(pattern));
    logger.warn(`Hook setting 'callerFilter' contains invalid regular expressions, which are ignored: ${invalidPatterns.join(", ")}`);
  }

  logger.debug(`frooky hook settings are valid`);
  return validHookSettings;
}

function isValidRegExp(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch (_) {
    return false;
  }
}

// Replaces invalid and missing decoder settings with defaults.
export function validateAndRepairDecoderSettings(settings: InputDecoderSettings): DecoderSettings {
  logger.debug(`Validating frooky decoder settings`);
  const result = inputDecoderSettingsSchema.safeParse(settings);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof DecoderSettings;
      (settings as Record<keyof DecoderSettings, unknown>)[key] = DEFAULT_DECODER_SETTINGS[key];
      logger.warn(
        `Decoder setting "'${String(key)}'" contains invalid data:\n${z.prettifyError(result.error)}\nThe value for '${String(key)}' was reset to the default: ${String(DEFAULT_DECODER_SETTINGS[key])}`,
      );
    }
  }

  const knownKeys = Object.keys(DEFAULT_DECODER_SETTINGS);
  const extraKeys = Object.keys(settings).filter((k) => !knownKeys.includes(k));
  if (extraKeys.length > 0) {
    logger.warn(`Decoder settings contain unknown properties: ${extraKeys.join(", ")}`);
  }

  logger.debug(`frooky decoder settings are valid`);
  return { ...DEFAULT_DECODER_SETTINGS, ...settings };
}

export function validateMetadata(metadata: FrookyMetadata, platform: Platform) {
  logger.debug(`Validating frooky metadata`);
  if (metadata.platform?.toLowerCase() !== platform.toLocaleLowerCase()) {
    logger.warn(`The platform declared in the frooky configuration does not match the actual platform (${platform}). Not all hooks may be valid.`);
  }
  const result = frookyMetadataSchema.safeParse(metadata);
  if (!result.success) {
    const pretty = z.prettifyError(result.error);
    logger.warn(`The metadata contains invalid entries: ${pretty}`);
  }
  logger.debug(`frooky meta data are valid`);
}

// Checks a hook declaration from a hook file against its input schema. Throws if it doesn't match, and warns about
// properties the schema doesn't know (e.g. a misspelled `retTyp`), which parsing drops.
export function validateInputHook<T>(schema: z.ZodType<T>, inputHook: unknown, label: string): T {
  const result = schema.safeParse(inputHook);
  if (!result.success) {
    throw new Error(z.prettifyError(result.error));
  }
  const unknownProperties = droppedKeys(inputHook, result.data);
  if (unknownProperties.length > 0) {
    logger.warn(`Hook for ${label} contains unknown properties, which are ignored: ${unknownProperties.join(", ")}`);
  }
  return result.data;
}

// Paths of the keys in `input` that are missing in `parsed`, e.g. `params[1].nmae`.
function droppedKeys(input: unknown, parsed: unknown, path = ""): string[] {
  if (Array.isArray(input) && Array.isArray(parsed)) {
    return input.flatMap((item, i) => droppedKeys(item, parsed[i], `${path}[${i}]`));
  }
  if (!isPlainObject(input) || !isPlainObject(parsed)) return [];
  return Object.keys(input).flatMap((key) => {
    const keyPath = path ? `${path}.${key}` : key;
    return key in parsed ? droppedKeys(input[key], parsed[key], keyPath) : [keyPath];
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
