import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../decoders/baseDecoder";
import { Direction, Param, RetType } from "../decoders/decodable";
import { DecodedValue } from "../decoders/decodedValue";
import { DecoderResolver } from "../decoders/decoderResolver";
import { DecoderArgRole, DecoderArgValues, RETURN_VALUE_DECODER_ARG } from "../decoders/decoderArgs";
import { logger } from "../logger";
import { PlatformStackTrace } from "../platformStackTrace";
import { FilterMismatchError, previewValue } from "../utils";
import { countFilteredCall, Hook } from "./hook";

export type ParamDecoder<TValue> = {
  decoder: Decoder<TValue>;
  argIndex: number;
  direction: Direction;
  name?: string;
  // where the value of each role in `decoderArgs` comes from
  decoderArgs?: Partial<Record<DecoderArgRole, DecoderArgSource<TValue>>>;
  argFilter?: RegExp[];
};

// The value of a role: another parameter, decoded with its own decoder, the return value, or a number
export type DecoderArgSource<TValue> =
  { kind: "param"; name: string; index: number; decoder: Decoder<TValue> } | { kind: "returnValue" } | { kind: "number"; value: number };

export type DecodedArgs = {
  in?: DecodedValue[];
  out?: DecodedValue[];
};

// A hook declaration whose class or module isn't loaded yet: `waiting` settles once that loads
export type Waiting<T> = { waiting: Promise<T> };

// What resolveHooks() knows about a hook declaration: the result right away if the first lookup decides it, else a
// promise that settles once the lookups at targetReady have run, with the result if they found the class or module,
// else with Waiting. The result is the declaration's hooks, or null if its method, symbol or offset doesn't exist.
export type Resolution<T> = T | Promise<T | Waiting<T>>;

export function isWaiting<T>(value: T | Waiting<T>): value is Waiting<T> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "waiting" in value;
}

// `resolution` with `project` applied to its result, also to one that comes later
export function mapResolution<T, U>(resolution: Resolution<T>, project: (result: T) => U): Resolution<U> {
  if (!(resolution instanceof Promise)) return project(resolution as T);
  return resolution.then((result) => (isWaiting(result) ? { waiting: result.waiting.then(project) } : project(result)));
}

export abstract class HookManager<TInputHook, THooks extends Hook, TValue> {
  private callCount = 0;

  constructor(
    private readonly decoderResolver: DecoderResolver<TValue>,
    protected readonly stackTrace: PlatformStackTrace,
    protected readonly frookyAgent: FrookyAgent,
  ) {}

  // Returns one Resolution per input hook (index-aligned). A hook on a class or module that isn't loaded yet is
  // installed while it loads, before its code runs (see registerHooks()). `source` names the hook file in log messages.
  public abstract resolveHooks(inputHooks: TInputHook[], source?: string): Promise<Resolution<THooks[] | null>[]>;
  // Returns how many hooks are installed: hooks that resolveHooks() already installed count as installed,
  // failures are logged and skipped.
  public abstract registerHooks(hooks: THooks[], source?: string): number;
  // Hooks that aren't installed are ignored.
  public abstract unregisterHooks(hooks: THooks[]): void;

  // `decoderArgs` were checked when the hook file was validated (see validateDecoderArgs())
  protected resolveParamDecoders(params: Param[]): ParamDecoder<TValue>[] {
    return params.map((param: Param, paramIndex: number) => {
      const { direction, ...paramDecodable } = param;
      const paramDecoder: ParamDecoder<TValue> = {
        decoder: this.decoderResolver.resolveDecoder(paramDecodable),
        argIndex: paramIndex,
        direction: param.direction,
        name: param.name,
        decoderArgs: this.resolveDecoderArgSources(param, params),
        argFilter: param.settings.argFilter?.map((pattern) => new RegExp(pattern)),
      };
      logger.debug(
        `Decoder for param '${param.type} ${param.name}' resolved: ${JSON.stringify({ ...paramDecoder, decoder: paramDecoder.decoder.decoderName, settings: param.settings }, null, 2)}`,
      );
      return paramDecoder;
    });
  }

  // Counts a call that a callerFilter or argFilter dropped (FilterMismatchError), logs any other error as `message: e`
  protected reportHookError(hook: THooks, e: unknown, message: string): void {
    if (e instanceof FilterMismatchError) countFilteredCall(hook);
    else logger.error(`${message}: ${e}`);
  }

  // The decoders of `params`, split by when they run: `in` before the call, `out` after it, `inout` in both
  protected resolveArgDecoders(params: Param[] | undefined): { in: ParamDecoder<TValue>[]; out: ParamDecoder<TValue>[] } {
    if (!params) return { in: [], out: [] };
    const argDecoders = this.resolveParamDecoders(params);
    return {
      in: argDecoders.filter((argDecoder) => argDecoder.direction === "in" || argDecoder.direction === "inout"),
      out: argDecoders.filter((argDecoder) => argDecoder.direction === "out" || argDecoder.direction === "inout"),
    };
  }

  private resolveDecoderArgSources(param: Param, params: Param[]): ParamDecoder<TValue>["decoderArgs"] {
    const decoderArgs = param.settings.decoderArgs;
    if (!decoderArgs) return undefined;
    const sources: Partial<Record<DecoderArgRole, DecoderArgSource<TValue>>> = {};
    for (const [role, value] of Object.entries(decoderArgs) as [DecoderArgRole, string | number][]) {
      if (typeof value === "number") {
        sources[role] = { kind: "number", value };
      } else if (value === RETURN_VALUE_DECODER_ARG) {
        sources[role] = { kind: "returnValue" };
      } else {
        const index = params.findIndex((p) => p.name === value);
        // with the referenced param's own settings, not e.g. the `decoder: string` of the buffer referencing it
        const decoder = this.decoderResolver.resolveDecoder({ type: params[index].type, settings: params[index].settings });
        sources[role] = { kind: "param", name: value, index, decoder };
      }
    }
    return sources;
  }

  protected resolveRetTypeDecoder(retType: RetType): Decoder<TValue> {
    return this.decoderResolver.resolveDecoder(retType);
  }

  protected matchesFilter(decodedValue: DecodedValue, argFilter?: RegExp[]): boolean {
    if (!argFilter || argFilter.length === 0) return true;
    const matches = (value: string | number) => argFilter.some((pattern) => pattern.test(String(value)));
    const value = filteredValue(decodedValue.value);
    if (typeof value === "string" || typeof value === "number") return matches(value);
    // e.g. `{ fd: 42, path: "/data/..." }` of `decoder: fd`
    if (isPlainObject(value)) {
      return Object.values(value).some((field) => {
        const fieldValue = filteredValue(field);
        return (typeof fieldValue === "string" || typeof fieldValue === "number") && matches(fieldValue);
      });
    }
    // lists, null and booleans
    return true;
  }

  // `target` of one hook call in debug logs, e.g. `[call 42] libc.so!read`. The host colors the `Decoded` logs of a
  // call by its number, as the logs of other calls come between its onEnter and onLeave logs.
  protected callLogTarget(target: string): string {
    return logger.isEnabled("debug") ? `[call ${++this.callCount}] ${target}` : target;
  }

  // At debug level logs e.g. `Decoded [call 42] com.example.Foo.bar param #0 'key' (java.lang.String, PrimitiveDecoder): "abc"`,
  // where `what` is `[call 42] com.example.Foo.bar param #0 'key'`.
  protected decodeValue(decoder: Decoder<TValue>, value: TValue, what: string, args?: DecoderArgValues): DecodedValue {
    const decodedValue = decoder.decode(value, args);
    // previewValue() serializes the whole decoded value
    if (logger.isEnabled("debug")) {
      logger.debug(`Decoded ${what} (${decoder.declaredType}, ${decoder.decoderName}): ${previewValue(decodedValue.value)}`);
    }
    return decodedValue;
  }

  // Throws FilterMismatchError if an argument doesn't match its argFilter. `target` is for debug logs. `returnValue`
  // is the decoded return value for `decoderArgs` with `$ret`, only known when decoding `out` parameters.
  protected decodeArgs(args: TValue[], paramDecoders: ParamDecoder<TValue>[], target: string = "hook", returnValue?: DecodedValue): DecodedValue[] {
    const decodedArgs: DecodedValue[] = [];
    for (const paramDecoder of paramDecoders) {
      const param = `${target} param #${paramDecoder.argIndex}${paramDecoder.name ? ` '${paramDecoder.name}'` : ""}`;
      const decoderArgValues = paramDecoder.decoderArgs ? this.decodeDecoderArgs(paramDecoder.decoderArgs, args, param, returnValue) : undefined;
      const decodedValue = this.decodeValue(paramDecoder.decoder, args[paramDecoder.argIndex], param, decoderArgValues);
      if (this.matchesFilter(decodedValue, paramDecoder.argFilter)) {
        decodedArgs.push(decodedValue);
      } else {
        throw new FilterMismatchError();
      }
    }

    return decodedArgs;
  }

  private decodeDecoderArgs(
    sources: Partial<Record<DecoderArgRole, DecoderArgSource<TValue>>>,
    args: TValue[],
    param: string,
    returnValue?: DecodedValue,
  ): DecoderArgValues {
    const values: DecoderArgValues = {};
    for (const [role, source] of Object.entries(sources) as [DecoderArgRole, DecoderArgSource<TValue>][]) {
      if (source.kind === "number") {
        values[role] = source.value;
      } else if (source.kind === "returnValue") {
        values[role] = returnValue?.value;
      } else {
        values[role] = this.decodeValue(source.decoder, args[source.index], `decoderArgs '${role}: ${source.name}' of ${param}`).value;
      }
    }
    return values;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The value a filter matches: a value decoded with its runtime type, e.g. a `java.lang.Object` parameter holding a
// `String`, is nested as `{ type: "java.lang.String", value: "..." }`, and the filter matches its inner value.
function filteredValue(value: unknown): unknown {
  while (isPlainObject(value) && typeof value.type === "string" && "value" in value) {
    value = value.value;
  }
  return value;
}
