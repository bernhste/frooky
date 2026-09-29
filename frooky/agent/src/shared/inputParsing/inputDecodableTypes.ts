import { validateAndRepairDecoderSettings } from "../configValidator";
import { Direction, Param, Decodable as RetType } from "../decoders/decodable";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_DECODE_AT } from "../defaultValues";
import { DecoderSettings } from "../frookySettings";
import { InputDecoderSettings, InputParamSettings } from "./inputSettings";

/**
 * A parameter in a hook file, normalized to a {@link Param}.
 *
 * | Case | Form                   | Example                                                        |
 * |------|------------------------|----------------------------------------------------------------|
 * | 1    | Type only              | `"java.lang.String"`                                           |
 * | 2    | Type + name            | `["java.lang.String", "value"]`                                |
 * | 3    | Type + settings        | `["[I", { direction: "in", maxDepth: 5 }]`                     |
 * | 4    | Type + name + settings | `["[B", "encryptedOutput", { direction: "in", maxItems: 32 }]` |
 * | 5    | Object                 | `{ type: int, name: age, direction: "in", settings: { ... }}`  |
 *
 * @public
 */
export type InputParam = string | [string, string] | [string, InputParamSettings] | [string, string, InputParamSettings] | Param;

function normalizeInputParam(input: InputParam, decoderSettings?: DecoderSettings): Param {
  const mergedSettings = decoderSettings ? { ...DEFAULT_DECODER_SETTINGS, ...decoderSettings } : DEFAULT_DECODER_SETTINGS;

  // the param's own settings override the merged file, group and hook settings field by field
  const toParam = (type: string, name?: string, direction?: Direction, paramSettings?: Partial<DecoderSettings>): Param => ({
    type,
    ...(name !== undefined && { name }),
    direction: direction ?? DEFAULT_DECODE_AT,
    settings: paramSettings ? validateAndRepairDecoderSettings({ ...mergedSettings, ...paramSettings }) : mergedSettings,
  });

  // Case 1: Type only - "java.lang.String"
  if (typeof input === "string") {
    return toParam(input);
  } else if (Array.isArray(input)) {
    // Case 2: Type + name - ["java.lang.String", "value"]
    if (input.length === 2 && typeof input[1] === "string") {
      const [type, name] = input;
      return toParam(type, name);
    }
    // Case 3: Type + settings - ["[I", { direction: "in", maxDepth: 5 }]
    if (input.length === 2 && typeof input[1] === "object") {
      const [type, { direction, ...paramSettings }] = input as [string, InputParamSettings];
      return toParam(type, undefined, direction, paramSettings);
    }
    // Case 4: Type + name + settings - ["[B", "encryptedOutput", { direction: "in", maxItems: 32 }]
    if (input.length === 3) {
      const [type, name, { direction, ...paramSettings }] = input as [string, string, InputParamSettings];
      return toParam(type, name, direction, paramSettings);
    }
  } else if (typeof input === "object" && input !== null && typeof input.type === "string") {
    // Case 5: Object - { type: "java.lang.String", name: "action" }
    const { type, name, direction, settings } = input as Partial<Param> & { type: string };
    return toParam(type, name, direction, settings);
  }
  throw new Error(`Unrecognized InputParam format: ${JSON.stringify(input)}`);
}

// Throws unless every `decoderArg` names exactly one other parameter of the list.
export function normalizeInputParams(inputs: InputParam[], decoderSettings?: DecoderSettings): Param[] {
  if (!Array.isArray(inputs)) {
    throw new Error(`Expected 'params' to be an array, but received ${inputs === undefined ? "undefined" : typeof inputs}.`);
  }
  const params = inputs.map((input) => normalizeInputParam(input, decoderSettings));
  validateDecoderArgs(params);
  return params;
}

function validateDecoderArgs(params: Param[]): void {
  params.forEach((param, paramIndex) => {
    const decoderArg = param.settings.decoderArg;
    if (decoderArg === undefined) return;

    const matches = params.map((p, i) => ({ p, i })).filter(({ p }) => p.name === decoderArg);
    if (matches.length === 0) {
      throw new Error(
        `decoderArg: no parameter named '${decoderArg}' found. Name the parameter whose runtime value you want to pass to the decoder.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(`decoderArg: more than one parameter is named '${decoderArg}'. Parameter names must be unique.`);
    }
    if (matches[0].i === paramIndex) {
      throw new Error(`decoderArg: '${decoderArg}' refers to the parameter itself. Name a different parameter.`);
    }
  });
}

/**
 * A return type in a hook file, normalized to a {@link RetType}.
 *
 * | Case | Form                    | Example                                                      |
 * |------|-------------------------|--------------------------------------------------------------|
 * | 1    | Type only               | `"int"`                                                      |
 * | 2    | Type + decoder settings | `["android.database.sqlite.SQLiteCursor", { maxItems: 10 }]` |
 * | 3    | Object                  | `{ type: int, settings: { maxDepth: 5 }}`                    |
 *
 * @public
 */
export type InputRetType = string | [string, Partial<DecoderSettings>] | RetType;

export function normalizeInputRetType(input: InputRetType, decoderSettings?: DecoderSettings): RetType {
  const mergedSettings = decoderSettings ? { ...DEFAULT_DECODER_SETTINGS, ...decoderSettings } : DEFAULT_DECODER_SETTINGS;

  const validatedMergedSettings = validateAndRepairDecoderSettings(mergedSettings);

  // Case 1: Type only - "int"
  if (typeof input === "string") {
    return { type: input, settings: validatedMergedSettings };
  } else if (Array.isArray(input)) {
    // Case 2: Type + decoder settings - ["android.database.sqlite.SQLiteCursor", { maxItems: 10 }]
    const [type, inlineSettings] = input as [string, Partial<DecoderSettings>];
    return { type, settings: { ...validatedMergedSettings, ...inlineSettings } };
  } else if (typeof input === "object") {
    // Case 3: Object
    return input;
  }
  throw new Error(`Unrecognized InputRetType format: ${JSON.stringify(input)}`);
}

/**
 * Decoder settings for the return value of a Java overload. The return type comes from reflection,
 * so no type is declared.
 *
 * | Form                  | Example           |
 * |-----------------------|-------------------|
 * | Decoder settings only | `{ maxDepth: 5 }` |
 *
 * @public
 */
export type InputRetTypeSettings = InputDecoderSettings;

export function normalizeInputRetTypeSettings(input: InputRetTypeSettings, decoderSettings?: DecoderSettings): DecoderSettings {
  const mergedSettings = decoderSettings ? { ...DEFAULT_DECODER_SETTINGS, ...decoderSettings } : DEFAULT_DECODER_SETTINGS;

  if (typeof input === "object" && input !== null && !Array.isArray(input) && !("type" in input)) {
    return validateAndRepairDecoderSettings({ ...mergedSettings, ...input });
  }
  throw new Error(`Unrecognized InputRetTypeSettings format: ${JSON.stringify(input)}`);
}
