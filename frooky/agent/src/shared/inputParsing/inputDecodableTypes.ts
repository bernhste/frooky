import { validateAndRepairDecoderSettings } from "../configValidator";
import { Param, Decodable as RetType } from "../decoders/decodable";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_DECODE_AT } from "../defaultValues";
import { DecoderSettings } from "../frookySettings";
import { InputParamSettings } from "./inputSettings";

/**
 * Flexible input format for defining a parameter in YAML configuration.
 *
 * | Case | Form                   | Type                                    | Example                                                              |
 * |------|------------------------|----------------------------------------|-----------------------------------------------------------------------|
 * | 1    | Type only              | `string`                               | `"java.lang.String"`                                                  |
 * | 2    | Type + name            | `[string, string]`                     | `["java.lang.String", "value"]`                                       |
 * | 3    | Type + settings        | `[string, InputParamSettings]`         | `["[I", "vector" { direction: "in", maxDepth: 5 }]`               |
 * | 4    | Type + name + settings | `[string, string, InputParamSettings]` | `["[B", "encryptedOutput", { direction: "in", fastDecode: true }]`  |
 * | 5    | Normalized object      | `Param`                                | `{ type: int, name: age, direction: "in", settings: { ... }}`         |
 *
 * Note: Internally we only use the normalized version. The other forms are used to add flexibility for the frooky input file.
 *
 * @public
 */
export type InputParam = string | [string, string] | [string, InputParamSettings] | [string, string, InputParamSettings] | Param;

export function normalizeInputParam(input: InputParam, decoderSettings?: DecoderSettings): Param {
  const mergedSettings = decoderSettings ? { ...DEFAULT_DECODER_SETTINGS, ...decoderSettings } : DEFAULT_DECODER_SETTINGS;

  // Case 1: Type only - "java.lang.String"
  if (typeof input === "string") {
    return { type: input, direction: DEFAULT_DECODE_AT, settings: mergedSettings };
  } else if (Array.isArray(input)) {
    // Case 2: Type + name - ["java.lang.String", "value"]
    if (input.length === 2 && typeof input[1] === "string") {
      const [type, name] = input;
      return { type, direction: DEFAULT_DECODE_AT, settings: mergedSettings, name };
    }
    // Case 3: Type + options - ["[I", { direction: "in", maxDepth: 5 }]
    if (input.length === 2 && typeof input[1] === "object") {
      const [type, { direction, ...inlineDecoderSettings }] = input as [string, InputParamSettings];
      const validatedDecoderSettings = validateAndRepairDecoderSettings({ ...DEFAULT_DECODER_SETTINGS, ...inlineDecoderSettings });
      return { type, direction: direction ?? DEFAULT_DECODE_AT, settings: validatedDecoderSettings };
    }
    // Case 4: Type + name + options - ["[B", "encryptedOutput", { direction: "in", fastDecode: true }]
    if (input.length === 3) {
      const [type, name, { direction, ...inlineDecoderSettings }] = input as [string, string, InputParamSettings];
      const validatedDecoderSettings = validateAndRepairDecoderSettings({ ...DEFAULT_DECODER_SETTINGS, ...inlineDecoderSettings });
      return { type, direction: direction ?? DEFAULT_DECODE_AT, settings: validatedDecoderSettings, name };
    }
  } else if (typeof input === "object") {
    // Case 5: Normalized object
    return input;
  }
  throw new Error(`Unrecognized InputParam format: ${JSON.stringify(input)}`);
}

/**
 * Flexible input format for defining a return type in YAML configuration.
 *
 * | Case | Form                    | Type                        | Example                                                          |
 * |------|-------------------------|-----------------------------|------------------------------------------------------------------|
 * | 1    | Type only               | `string`                    | `"int"`                                                          |
 * | 2    | Type + decoder settings | `[string, DecoderSettings]` | `["android.database.sqlite.SQLiteCursor", { maxItems: 10 }]`  |
 * | 3    | Normalized object       | `DecodableType`             | `{ type: int, decoderSettings: { fastDecode: true }}`          |
 *
 *  Note: Internally we only use the normalized version. The other forms are used to add flexibility for the frooky input file.
 *
 * @public
 */
export type InputRetType = string | [string, Partial<DecoderSettings>] | RetType;

export function normalizeInputRetType(input: InputRetType, decoderSettings?: DecoderSettings): RetType {
  const mergedSettings = decoderSettings ? { ...DEFAULT_DECODER_SETTINGS, ...decoderSettings } : DEFAULT_DECODER_SETTINGS;

  // validate and repair merged settings
  const validatedMergedSettings = validateAndRepairDecoderSettings(mergedSettings);

  // Case 1: Type only - "int"
  if (typeof input === "string") {
    return { type: input, settings: validatedMergedSettings };
  } else if (Array.isArray(input)) {
    // Case 2: Type + decoder settings - ["android.database.sqlite.SQLiteCursor", { maxItems: 10 }]
    const [type, inlineSettings] = input as [string, Partial<DecoderSettings>];
    return { type, settings: { ...validatedMergedSettings, ...inlineSettings } };
  } else if (typeof input === "object") {
    // Case 3: Normalized object
    return input;
  }
  throw new Error(`Unrecognized InputRetType format: ${JSON.stringify(input)}`);
}

/**
 * Flexible input format for declaring only the decoder settings of a return value, without a type.
 *
 * Used for Java overloads, where the return type is always resolved via Frida's own reflection and
 * can never be declared - only how the returned value is decoded can be customized. Accepts every
 * shape {@link InputRetType} does (as native hooks use), so that a user who is used to writing
 * `retType: [type, decoderSettings]` or `retType: type` for native hooks doesn't end up with an
 * invalid hook file by reusing that habit here. Any type given this way is simply ignored, since
 * Java hooks have no use for it.
 *
 * | Case | Form                    | Example                                                          |
 * |------|-------------------------|-------------------------------------------------------------------|
 * | 1    | Type only (ignored)     | `"int"`                                                            |
 * | 2    | Type (ignored) + settings | `["int", { maxItems: 10 }]`                                   |
 * | 3    | Normalized `RetType` (type ignored) | `{ type: "int", settings: { fastDecode: true } }`   |
 * | 4    | Decoder settings only (documented Java form) | `{ fastDecode: true }`                    |
 *
 * @public
 */
export type InputRetTypeSettings = InputRetType | Partial<DecoderSettings>;

export function normalizeInputRetTypeSettings(input: InputRetTypeSettings, decoderSettings?: DecoderSettings): DecoderSettings {
  const mergedSettings = decoderSettings ? { ...DEFAULT_DECODER_SETTINGS, ...decoderSettings } : DEFAULT_DECODER_SETTINGS;

  // Case 1: Type only (ignored) - "int"
  if (typeof input === "string") {
    return validateAndRepairDecoderSettings(mergedSettings);
  } else if (Array.isArray(input)) {
    // Case 2: Type (ignored) + decoder settings - ["int", { maxItems: 10 }]
    const [, inlineSettings] = input as [string, Partial<DecoderSettings>];
    return validateAndRepairDecoderSettings({ ...mergedSettings, ...inlineSettings });
  } else if (typeof input === "object" && "type" in input) {
    // Case 3: Normalized RetType object (type ignored) - { type: "int", settings: {...} }
    return validateAndRepairDecoderSettings({ ...mergedSettings, ...(input as RetType).settings });
  } else if (typeof input === "object") {
    // Case 4: Decoder settings only - { maxItems: 10 }
    return validateAndRepairDecoderSettings({ ...mergedSettings, ...(input as Partial<DecoderSettings>) });
  }
  throw new Error(`Unrecognized InputRetTypeSettings format: ${JSON.stringify(input)}`);
}
