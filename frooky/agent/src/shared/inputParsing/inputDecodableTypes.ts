import { validateAndRepairValueDecoderSettings } from "../configValidator";
import { Direction, Param, RetType } from "../decoders/decodable";
import { DEFAULT_DECODE_AT, DEFAULT_BASE_DECODER_SETTINGS } from "../defaultValues";
import { DecoderSettings, BaseDecoderSettings } from "../frookySettings";
import { DECODER_ARG_ROLES, DecoderArgRole, RETURN_VALUE_DECODER_ARG } from "../decoders/decoderArgs";
import { InputParamSettings, InputValueDecoderSettings } from "./inputSettings";

/**
 * A parameter declared as an object.
 *
 * @public
 */
export interface InputParamObject {
  /** Declared type, e.g. `int`, `java.lang.String`, `[B` or `char *`. */
  type: string;

  /** Name shown for the value in events. */
  name?: string;

  /** When the parameter is decoded. Default: `"in"`. */
  direction?: Direction;

  /** Decoder settings for this parameter. Override the hook's settings. */
  settings?: InputValueDecoderSettings;
}

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
export type InputParam = string | [string, string] | [string, InputParamSettings] | [string, string, InputParamSettings] | InputParamObject;

function normalizeInputParam(input: InputParam, decoderSettings: BaseDecoderSettings): Param {
  // the param's own settings override the merged file, collection and hook settings field by field
  const toParam = (type: string, name?: string, direction?: Direction, paramSettings?: InputValueDecoderSettings): Param => ({
    type,
    ...(name !== undefined && { name }),
    direction: direction ?? DEFAULT_DECODE_AT,
    settings: paramSettings ? validateAndRepairValueDecoderSettings({ ...decoderSettings, ...paramSettings }) : decoderSettings,
  });

  // Case 1: Type only - "java.lang.String"
  if (typeof input === "string") {
    return toParam(input);
  }
  if (Array.isArray(input)) {
    // Case 2: Type + name - ["java.lang.String", "value"]
    if (input.length === 2 && typeof input[1] === "string") {
      return toParam(input[0], input[1]);
    }
    // Case 3: Type + settings - ["[I", { direction: "in", maxDepth: 5 }]
    if (input.length === 2) {
      const [type, { direction, ...paramSettings }] = input as [string, InputParamSettings];
      return toParam(type, undefined, direction, paramSettings);
    }
    // Case 4: Type + name + settings - ["[B", "encryptedOutput", { direction: "in", maxItems: 32 }]
    const [type, name, { direction, ...paramSettings }] = input as [string, string, InputParamSettings];
    return toParam(type, name, direction, paramSettings);
  }
  // Case 5: Object - { type: "java.lang.String", name: "action" }
  return toParam(input.type, input.name, input.direction, input.settings);
}

// Throws unless the `decoderArgs` of every parameter are valid, see validateDecoderArgs().
export function normalizeInputParams(inputs: InputParam[], decoderSettings: BaseDecoderSettings = DEFAULT_BASE_DECODER_SETTINGS): Param[] {
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

// Throws if a value sets a `config` option its decoder doesn't accept, e.g. `constants` with `decoder: base64`.
// `values` are pairs of a label for the message and the value's settings; `acceptedOptions` lists them per platform.
export function validateDecoderConfig(
  values: [label: string, settings: DecoderSettings | undefined][],
  acceptedOptions: (settings: DecoderSettings) => readonly string[],
): void {
  for (const [label, settings] of values) {
    const options = Object.keys(settings?.config ?? {});
    if (!settings || options.length === 0) continue;
    const accepted = acceptedOptions(settings);
    const rejected = options.filter((option) => !accepted.includes(option));
    if (rejected.length > 0) {
      const decoder = settings.decoder ? `decoder '${settings.decoder}'` : "the decoder of its type";
      throw new Error(
        `config of '${label}': ${decoder} doesn't accept ${rejected.map((o) => `'${o}'`).join(", ")}. ${accepted.length ? `It accepts: ${accepted.join(", ")}.` : "It accepts no config."}`,
      );
    }
  }
}

// Throws if a value uses a decoder of another platform, e.g. `decoder: fd` in a Java hook. `names` lists the
// decoders of the hook's platform.
export function validateDecoderNames(settings: (Partial<DecoderSettings> | undefined)[], names: readonly string[], platform: string): void {
  for (const decoder of settings.map((s) => s?.decoder)) {
    if (decoder !== undefined && !names.includes(decoder)) {
      throw new Error(`decoder '${decoder}' is no ${platform} decoder. The ${platform} decoders are: ${names.join(", ")}.`);
    }
  }
}

/**
 * A return type declared as an object.
 *
 * @public
 */
export interface InputRetTypeObject {
  /** Declared type, e.g. `int` or `char *`. */
  type: string;

  /** Name shown for the value in events. */
  name?: string;

  /** Decoder settings for the return value. Override the hook's settings. */
  settings?: InputValueDecoderSettings;
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
export type InputRetType = string | [string, InputValueDecoderSettings] | InputRetTypeObject;

export function normalizeInputRetType(input: InputRetType, decoderSettings: BaseDecoderSettings = DEFAULT_BASE_DECODER_SETTINGS): RetType {
  // Case 1: Type only - "int"
  if (typeof input === "string") {
    return { type: input, settings: decoderSettings };
  }
  // Case 2: Type + decoder settings - ["android.database.sqlite.SQLiteCursor", { maxItems: 10 }]
  // Case 3: Object - { type: int, settings: { maxDepth: 5 } }
  const { type, name, settings } = Array.isArray(input) ? { type: input[0], name: undefined, settings: input[1] } : input;
  rejectRetTypeDecoderArgs(settings);
  return {
    type,
    ...(name !== undefined && { name }),
    settings: settings ? validateAndRepairValueDecoderSettings({ ...decoderSettings, ...settings }) : decoderSettings,
  };
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
export type InputRetTypeSettings = InputValueDecoderSettings;

export function normalizeInputRetTypeSettings(
  input: InputRetTypeSettings,
  decoderSettings: BaseDecoderSettings = DEFAULT_BASE_DECODER_SETTINGS,
): DecoderSettings {
  rejectRetTypeDecoderArgs(input);
  return validateAndRepairValueDecoderSettings({ ...decoderSettings, ...input });
}
