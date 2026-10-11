import z from "zod";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS, DEFAULT_BASE_DECODER_SETTINGS } from "./defaultValues";
import { InputFrookyConfig, SCHEMA_VERSION } from "./frookyConfig";
import { FrookyMetadata, Platform } from "./frookyMetadata";
import { DecoderSettings, FrookySettings, HookSettings, BaseDecoderSettings } from "./frookySettings";
import { InputDecoderSettings, InputHookSettings, InputParamSettings } from "./inputParsing/inputSettings";
import { inputFrookyConfigSchema } from "./inputParsing/zodSchemas/frookyConfig.zod";
import { frookyMetadataSchema } from "./inputParsing/zodSchemas/frookyMetadata.zod";
import { decoderSettingsSchema, hookSettingsSchema, baseDecoderSettingsSchema } from "./inputParsing/zodSchemas/frookySettings.zod";
import { logger } from "./logger";

const inputFrookyConfigHeaderSchema = inputFrookyConfigSchema.omit({ hookCollections: true });

// Throws unless everything in a hook file outside its hook collections and its metadata is valid. Returns the file's
// settings, completed with the defaults.
export function validateFrookyConfig(frookyConfig: InputFrookyConfig, platform: Platform): FrookySettings {
  logger.debug(`Validating frooky config`);

  const { hookCollections, ...header } = frookyConfig;
  if (header.schemaVersion !== undefined && header.schemaVersion !== SCHEMA_VERSION) {
    throw Error(
      `'schemaVersion: ${JSON.stringify(header.schemaVersion)}' is not supported. This version of frooky reads schemaVersion ${SCHEMA_VERSION}.`,
    );
  }
  if (!Array.isArray(hookCollections)) {
    throw Error(`'hookCollections' must be a list of hook collections, but is ${JSON.stringify(hookCollections) ?? "missing"}.`);
  }
  const { metadata, ...strictHeader } = header;
  validateInput(inputFrookyConfigHeaderSchema, strictHeader, "The hook file");
  if (metadata !== undefined) validateMetadata(metadata, platform);

  const settings: FrookySettings = {
    hookSettings: validateHookSettings({ ...DEFAULT_HOOK_SETTINGS, ...header.hookSettings }),
    decoderSettings: validateDecoderSettings({ ...DEFAULT_BASE_DECODER_SETTINGS, ...header.decoderSettings }),
  };
  logger.debug(`Frooky config is valid`);
  return settings;
}

// Metadata is informational, so it never invalidates a hook file: fields frooky doesn't know are accepted, and a
// known field with an invalid value or a platform other than the device's only causes a warning.
function validateMetadata(metadata: FrookyMetadata, platform: Platform): void {
  const result = frookyMetadataSchema.safeParse(metadata);
  if (!result.success) {
    logger.warn(`The metadata contains invalid entries:\n${z.prettifyError(result.error)}`);
    return;
  }
  if (result.data.platform !== undefined && result.data.platform.toLowerCase() !== platform.toLowerCase()) {
    logger.warn(`The platform declared in the frooky configuration does not match the actual platform (${platform}). Not all hooks may be valid.`);
  }
}

// Completes hook settings with the defaults. Throws for an invalid value, an unknown setting or a `callerFilter`
// pattern that is no regular expression.
export function validateHookSettings(settings: InputHookSettings): HookSettings {
  const validHookSettings = validateInput(hookSettingsSchema, { ...DEFAULT_HOOK_SETTINGS, ...settings }, "hookSettings");

  // an invalid pattern would throw on every intercepted call
  const invalidPatterns = validHookSettings.callerFilter.filter((pattern) => !isValidRegExp(pattern));
  if (invalidPatterns.length > 0) {
    throw Error(`'callerFilter' contains invalid regular expressions: ${invalidPatterns.join(", ")}`);
  }
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

// Completes the decoder settings of the file, a hook collection or a hook with the defaults. Throws for an invalid
// value or a setting that only a parameter or return value can have, e.g. `argFilter`.
export function validateDecoderSettings(settings: InputDecoderSettings): BaseDecoderSettings {
  return validateInput(baseDecoderSettingsSchema, { ...DEFAULT_BASE_DECODER_SETTINGS, ...settings }, "decoderSettings");
}

// Completes the decoder settings of a parameter or return value with the defaults. Throws for an invalid value or an
// unknown setting.
export function validateValueDecoderSettings(settings: Omit<InputParamSettings, "direction">): DecoderSettings {
  return validateInput(decoderSettingsSchema, { ...DEFAULT_DECODER_SETTINGS, ...settings }, "decoder settings");
}

// False for a hook collection whose `hooks` isn't a list, e.g. `hooks: open`, whose characters would otherwise be
// taken as hooks. `target` names the collection, e.g. `class 'android.content.Intent'`.
export function hasHookList(hookCollection: { hooks?: unknown }, target: string): boolean {
  if (Array.isArray(hookCollection.hooks)) return true;
  const example = typeof hookCollection.hooks === "string" ? hookCollection.hooks : "name";
  logger.warn(
    `Skipping the hook collection for ${target}: 'hooks' must be a list, e.g. 'hooks: [${example}]', but is ${JSON.stringify(hookCollection.hooks) ?? "missing"}.`,
  );
  return false;
}

// Checks a part of a hook file against its input schema. Throws if it doesn't match or has properties the schema
// doesn't know (e.g. a misspelled `returs`). `label` names the part, e.g. `The hook file`.
export function validateInput<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(`${label} is invalid:\n${z.prettifyError(result.error)}`);
  }
  const unknownProperties = droppedKeys(input, result.data);
  if (unknownProperties.length > 0) {
    throw new Error(`${label} contains unknown properties: ${unknownProperties.join(", ")}`);
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
    if (input[key] === undefined) return [];
    const keyPath = path ? `${path}.${key}` : key;
    return key in parsed ? droppedKeys(input[key], parsed[key], keyPath) : [keyPath];
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
