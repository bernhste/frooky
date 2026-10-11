import { validateValueDecoderSettings } from "../configValidator";
import { Param, RetType } from "../decoders/decodable";
import { DEFAULT_DECODE_AT, DEFAULT_BASE_DECODER_SETTINGS } from "../defaultValues";
import { DecoderSettings, BaseDecoderSettings } from "../frookySettings";
import { DecoderArgRole, decoderArgsOf, RETURN_VALUE_DECODER_ARG } from "../decoders/decoderArgs";
import { InputParamSettings, InputReturnSettings } from "./inputSettings";

/**
 * A parameter declared as an object: its type, its name and its settings.
 *
 * @public
 */
export interface InputParamObject extends InputParamSettings {
  /** Declared type, e.g. `int`, `java.lang.String`, `[B` or `char *`. */
  type: string;

  /** Name shown for the value in events. */
  name?: string;
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
 * | 5    | Object                 | `{ type: int, name: age, direction: "in", maxItems: 32 }`      |
 *
 * @public
 */
export type InputParam = string | [string, string] | [string, InputParamSettings] | [string, string, InputParamSettings] | InputParamObject;

function normalizeInputParam(input: InputParam, decoderSettings: BaseDecoderSettings): Param {
  // the param's own settings override the merged file, collection and hook settings field by field
  const toParam = (type: string, name?: string, { direction, ...paramSettings }: InputParamSettings = {}): Param => ({
    type,
    ...(name !== undefined && { name }),
    direction: direction ?? DEFAULT_DECODE_AT,
    settings: validateValueDecoderSettings({ ...decoderSettings, ...paramSettings }),
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
      return toParam(input[0], undefined, input[1] as InputParamSettings);
    }
    // Case 4: Type + name + settings - ["[B", "encryptedOutput", { direction: "in", maxItems: 32 }]
    const [type, name, paramSettings] = input as [string, string, InputParamSettings];
    return toParam(type, name, paramSettings);
  }
  // Case 5: Object - { type: "java.lang.String", name: "action", maxItems: 32 }
  const { type, name, ...paramSettings } = input;
  return toParam(type, name, paramSettings);
}

// Throws unless `length` and `offset` of every parameter are valid, see validateDecoderArgs().
export function normalizeInputParams(inputs: InputParam[], decoderSettings: BaseDecoderSettings = DEFAULT_BASE_DECODER_SETTINGS): Param[] {
  const params = inputs.map((input) => normalizeInputParam(input, decoderSettings));
  params.forEach((param, paramIndex) => validateDecoderArgs(param, paramIndex, params));
  return params;
}

// Throws unless the value of `length` and `offset` is a number, the return value of an `out` parameter, or the name
// of exactly one other parameter.
function validateDecoderArgs(param: Param, paramIndex: number, params: Param[]): void {
  const label = param.name ?? param.type;
  for (const [role, value] of Object.entries(decoderArgsOf(param.settings))) {
    if (typeof value === "number") {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`'${role}: ${value}' of '${label}' must be a non-negative integer.`);
      }
      continue;
    }
    if (value === RETURN_VALUE_DECODER_ARG) {
      if (param.direction !== "out") {
        throw new Error(
          `'${role}: ${RETURN_VALUE_DECODER_ARG}' of '${label}' is the return value, which only exists once the call returns. Set 'direction: out' on '${label}'.`,
        );
      }
      continue;
    }

    const matches = params.map((p, i) => ({ p, i })).filter(({ p }) => p.name === value);
    if (matches.length === 0) {
      throw new Error(`'${role}: ${value}' of '${label}' names no parameter. Use the name of another parameter, '$ret' or a number.`);
    }
    if (matches.length > 1) {
      throw new Error(`'${role}: ${value}' of '${label}': more than one parameter is named '${value}'. Parameter names must be unique.`);
    }
    if (matches[0].i === paramIndex) {
      throw new Error(`'${role}: ${value}' of '${label}' is the parameter itself. Name a different parameter.`);
    }
  }
}

// Throws if a parameter sets `length` or `offset` and its decoder doesn't accept it. `acceptedRoles` lists them per
// platform.
export function validateDecoderArgRoles(params: Param[] | undefined, acceptedRoles: (param: Param) => readonly DecoderArgRole[]): void {
  for (const param of params ?? []) {
    const roles = Object.keys(decoderArgsOf(param.settings)) as DecoderArgRole[];
    if (roles.length === 0) continue;
    const accepted = acceptedRoles(param);
    const rejected = roles.filter((role) => !accepted.includes(role));
    if (rejected.length > 0) {
      const decoder = param.settings.decoder ? `decoder '${param.settings.decoder}'` : `the decoder of '${param.type}'`;
      throw new Error(
        `'${param.name ?? param.type}': ${decoder} doesn't accept ${rejected.map((r) => `'${r}'`).join(" and ")}. ${accepted.length ? `It accepts: ${accepted.join(", ")}.` : "It accepts neither 'length' nor 'offset'."}`,
      );
    }
  }
}

// Throws if a value sets a `decoderOptions` option its decoder doesn't accept, e.g. `constants` with `decoder: base64`.
// `values` are pairs of a label for the message and the value's settings; `acceptedOptions` lists them per platform.
export function validateDecoderOptions(
  values: [label: string, settings: DecoderSettings | undefined][],
  acceptedOptions: (settings: DecoderSettings) => readonly string[],
): void {
  for (const [label, settings] of values) {
    const options = Object.keys(settings?.decoderOptions ?? {});
    if (!settings || options.length === 0) continue;
    const accepted = acceptedOptions(settings);
    const rejected = options.filter((option) => !accepted.includes(option));
    if (rejected.length > 0) {
      const decoder = settings.decoder ? `decoder '${settings.decoder}'` : "the decoder of its type";
      throw new Error(
        `decoderOptions of '${label}': ${decoder} doesn't accept ${rejected.map((o) => `'${o}'`).join(", ")}. ${accepted.length ? `It accepts: ${accepted.join(", ")}.` : "It accepts no decoderOptions."}`,
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
 * A return value declared as an object: its type, its name and its decoder settings.
 *
 * @public
 */
export interface InputReturnObject extends InputReturnSettings {
  /** Declared type, e.g. `int` or `char *`. */
  type: string;

  /** Name shown for the value in events. */
  name?: string;
}

/**
 * The return value of a native hook, normalized to a {@link RetType}.
 *
 * | Case | Form                    | Example                         |
 * |------|-------------------------|---------------------------------|
 * | 1    | Type only               | `"int"`                         |
 * | 2    | Type + decoder settings | `["char *", { maxItems: 256 }]` |
 * | 3    | Object                  | `{ type: int, decoder: errno }` |
 *
 * @public
 */
export type InputReturn = string | [string, InputReturnSettings] | InputReturnObject;

export function normalizeInputReturn(input: InputReturn, decoderSettings: BaseDecoderSettings = DEFAULT_BASE_DECODER_SETTINGS): RetType {
  const toRetType = (type: string, name?: string, settings: InputReturnSettings = {}): RetType => ({
    type,
    ...(name !== undefined && { name }),
    settings: validateValueDecoderSettings({ ...decoderSettings, ...settings }),
  });

  // Case 1: Type only - "int"
  if (typeof input === "string") {
    return toRetType(input);
  }
  // Case 2: Type + decoder settings - ["char *", { maxItems: 256 }]
  if (Array.isArray(input)) {
    return toRetType(input[0], undefined, input[1]);
  }
  // Case 3: Object - { type: int, decoder: errno }
  const { type, name, ...settings } = input;
  return toRetType(type, name, settings);
}

// The decoder settings for the return value of a Java overload, whose `returns` declares no type
export function normalizeInputReturnSettings(
  input: InputReturnSettings,
  decoderSettings: BaseDecoderSettings = DEFAULT_BASE_DECODER_SETTINGS,
): DecoderSettings {
  return validateValueDecoderSettings({ ...decoderSettings, ...input });
}
