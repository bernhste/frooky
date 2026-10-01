import { validateAndRepairDecoderSettings } from "../configValidator";
import { Direction, Param, Decodable as RetType } from "../decoders/decodable";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_DECODE_AT } from "../defaultValues";
import { DecoderSettings } from "../frookySettings";
import { DECODER_ARG_ROLES, DecoderArgRole, RETURN_VALUE_DECODER_ARG } from "../decoders/decoderArgs";
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

// Throws unless the `decoderArgs` of every parameter are valid, see validateDecoderArgs().
export function normalizeInputParams(inputs: InputParam[], decoderSettings?: DecoderSettings): Param[] {
  if (!Array.isArray(inputs)) {
    throw new Error(`Expected 'params' to be an array, but received ${inputs === undefined ? "undefined" : typeof inputs}.`);
  }
  const params = inputs.map((input) => normalizeInputParam(input, decoderSettings));
  params.forEach((param, paramIndex) => validateDecoderArgs(param, paramIndex, params));
  return params;
}

// Throws unless every role in `decoderArgs` is known and its value is a number, the return value of an `out`
// parameter, or the name of exactly one other parameter.
function validateDecoderArgs(param: Param, paramIndex: number, params: Param[]): void {
  const label = param.name ?? param.type;
  if ((param.settings as { decoderArg?: unknown }).decoderArg !== undefined) {
    throw new Error(`'decoderArg' is no decoder setting. Pass the value by its role, e.g. 'decoderArgs: { length: len }' on '${label}'.`);
  }
  const decoderArgs = param.settings.decoderArgs;
  if (decoderArgs === undefined) return;
  if (typeof decoderArgs !== "object" || decoderArgs === null || Array.isArray(decoderArgs)) {
    throw new Error(`decoderArgs of '${label}' must be an object of roles, e.g. '{ length: len }'.`);
  }

  for (const [role, value] of Object.entries(decoderArgs)) {
    if (!DECODER_ARG_ROLES.includes(role as DecoderArgRole)) {
      throw new Error(`decoderArgs of '${label}': '${role}' is no role. The roles are: ${DECODER_ARG_ROLES.join(", ")}.`);
    }
    if (typeof value === "number") {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`decoderArgs of '${label}': '${role}: ${value}' must be a non-negative integer.`);
      }
      continue;
    }
    if (value === RETURN_VALUE_DECODER_ARG) {
      if (param.direction !== "out") {
        throw new Error(
          `decoderArgs of '${label}': '${role}: ${RETURN_VALUE_DECODER_ARG}' is the return value, which only exists once the call returns. Set 'direction: out' on '${label}'.`,
        );
      }
      continue;
    }

    const matches = params.map((p, i) => ({ p, i })).filter(({ p }) => p.name === value);
    if (matches.length === 0) {
      throw new Error(`decoderArgs of '${label}': '${role}: ${value}' names no parameter. Use the name of another parameter, '$ret' or a number.`);
    }
    if (matches.length > 1) {
      throw new Error(`decoderArgs of '${label}': more than one parameter is named '${value}'. Parameter names must be unique.`);
    }
    if (matches[0].i === paramIndex) {
      throw new Error(`decoderArgs of '${label}': '${role}: ${value}' is the parameter itself. Name a different parameter.`);
    }
  }
}

// The return value is decoded first, so it can't use other values
function rejectRetTypeDecoderArgs(settings: object | undefined): void {
  const inline = settings as { decoderArgs?: unknown; decoderArg?: unknown } | undefined;
  if (inline?.decoderArgs !== undefined || inline?.decoderArg !== undefined) {
    throw new Error(`'decoderArgs' is only supported on parameters, not on the return value.`);
  }
}

// Throws if a parameter passes a role its decoder doesn't accept. `acceptedRoles` lists them per platform.
export function validateDecoderArgRoles(params: Param[] | undefined, acceptedRoles: (param: Param) => readonly DecoderArgRole[]): void {
  for (const param of params ?? []) {
    const roles = Object.keys(param.settings.decoderArgs ?? {}) as DecoderArgRole[];
    if (roles.length === 0) continue;
    const accepted = acceptedRoles(param);
    const rejected = roles.filter((role) => !accepted.includes(role));
    if (rejected.length > 0) {
      const decoder = param.settings.decoder ? `decoder '${param.settings.decoder}'` : `the decoder of '${param.type}'`;
      throw new Error(
        `decoderArgs of '${param.name ?? param.type}': ${decoder} doesn't accept the role${rejected.length > 1 ? "s" : ""} ${rejected.map((r) => `'${r}'`).join(", ")}. ${accepted.length ? `It accepts: ${accepted.join(", ")}.` : "It accepts no decoderArgs."}`,
      );
    }
  }
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
    rejectRetTypeDecoderArgs(inlineSettings);
    return { type, settings: { ...validatedMergedSettings, ...inlineSettings } };
  } else if (typeof input === "object") {
    // Case 3: Object
    rejectRetTypeDecoderArgs(input.settings);
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
    rejectRetTypeDecoderArgs(input);
    return validateAndRepairDecoderSettings({ ...mergedSettings, ...input });
  }
  throw new Error(`Unrecognized InputRetTypeSettings format: ${JSON.stringify(input)}`);
}
