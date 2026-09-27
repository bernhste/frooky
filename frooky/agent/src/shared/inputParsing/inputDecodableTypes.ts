import { validateAndRepairDecoderSettings } from "../configValidator";
import { Direction, Param, Decodable as RetType } from "../decoders/decodable";
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
 * | 3    | Type + settings        | `[string, InputParamSettings]`         | `["[I", { direction: "in", maxDepth: 5 }]`                            |
 * | 4    | Type + name + settings | `[string, string, InputParamSettings]` | `["[B", "encryptedOutput", { direction: "in", maxItems: 32 }]`        |
 * | 5    | Object                 | `Param`, all but `type` optional       | `{ type: int, name: age, direction: "in", settings: { ... }}`         |
 *
 * Note: Internally we only use the normalized version. The other forms are used to add flexibility for the frooky input file.
 * Every form is normalized into a complete {@link Param}.
 *
 * @public
 */
export type InputParam = string | [string, string] | [string, InputParamSettings] | [string, string, InputParamSettings] | Param;

function normalizeInputParam(input: InputParam, decoderSettings?: DecoderSettings): Param {
  const mergedSettings = decoderSettings ? { ...DEFAULT_DECODER_SETTINGS, ...decoderSettings } : DEFAULT_DECODER_SETTINGS;

  // every form ends up here, so each one gets the same defaults: the param's own settings override the
  // merged ones (file, group and hook level) field by field, and are validated
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
    // Case 3: Type + options - ["[I", { direction: "in", maxDepth: 5 }]
    if (input.length === 2 && typeof input[1] === "object") {
      const [type, { direction, ...paramSettings }] = input as [string, InputParamSettings];
      return toParam(type, undefined, direction, paramSettings);
    }
    // Case 4: Type + name + options - ["[B", "encryptedOutput", { direction: "in", maxItems: 32 }]
    if (input.length === 3) {
      const [type, name, { direction, ...paramSettings }] = input as [string, string, InputParamSettings];
      return toParam(type, name, direction, paramSettings);
    }
  } else if (typeof input === "object" && input !== null && typeof input.type === "string") {
    // Case 5: Object - { type: "java.lang.String", name: "action" }, direction and settings are optional
    const { type, name, direction, settings } = input as Partial<Param> & { type: string };
    return toParam(type, name, direction, settings);
  }
  throw new Error(`Unrecognized InputParam format: ${JSON.stringify(input)}`);
}

/**
 * Normalizes a parameter list and checks that every `decoderArg` names another parameter of the same list.
 *
 * @throws If a `decoderArg` names no parameter, or the parameter that declares it.
 */
export function normalizeInputParams(inputs: InputParam[], decoderSettings?: DecoderSettings): Param[] {
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
 * Flexible input format for defining a return type in YAML configuration.
 *
 * | Case | Form                    | Type                        | Example                                                          |
 * |------|-------------------------|-----------------------------|------------------------------------------------------------------|
 * | 1    | Type only               | `string`                    | `"int"`                                                          |
 * | 2    | Type + decoder settings | `[string, DecoderSettings]` | `["android.database.sqlite.SQLiteCursor", { maxItems: 10 }]`     |
 * | 3    | Normalized object       | `RetType`                   | `{ type: int, settings: { maxDepth: 5 }}`                        |
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
 * | Case | Form                    | Example                                                           |
 * |------|-------------------------|-------------------------------------------------------------------|
 * | 1    | Type only (ignored)     | `"int"`                                                           |
 * | 2    | Type (ignored) + settings | `["int", { maxItems: 10 }]`                                     |
 * | 3    | Normalized `RetType` (type ignored) | `{ type: "int", settings: { maxDepth: 5 } }`          |
 * | 4    | Decoder settings only (documented Java form) | `{ maxDepth: 5 }`                            |
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
