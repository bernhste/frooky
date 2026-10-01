import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../decoders/baseDecoder";
import { Direction, Param, RetType } from "../decoders/decodable";
import { DecodedValue } from "../decoders/decodedValue";
import { DecoderResolver } from "../decoders/decoderResolver";
import { DecoderArgRole, DecoderArgValues, RETURN_VALUE_DECODER_ARG } from "../decoders/decoderArgs";
import { HOOK_LOOKUP_INTERVAL_MS } from "../defaultValues";
import { logger } from "../logger";
import { PlatformStackTrace } from "../platformStackTrace";
import { FilterMismatchError, previewValue } from "../utils";
import { Hook } from "./hook";

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

export abstract class HookManager<TInputHook, THooks extends Hook, TValue> {
  constructor(
    private readonly decoderResolver: DecoderResolver<TValue>,
    protected readonly stackTrace: PlatformStackTrace,
    protected readonly frookyAgent: FrookyAgent,
  ) {}

  // Returns one promise per input hook (index-aligned), resolving to its hooks or null if it failed.
  // `source` names the hook file in log messages.
  public abstract resolveHooks(inputHooks: TInputHook[], timeout: number, source?: string): Promise<Promise<THooks[] | null>[]>;
  // Returns how many hooks were installed, failures are logged and skipped.
  public abstract registerHooks(hooks: THooks[], source?: string): number;
  // Hooks that aren't installed are ignored.
  public abstract unregisterHooks(hooks: THooks[]): void;

  // Polls `fn` until it returns a value, e.g. `label` `Module 'libfoo.so'` for the timeout error. If the first call
  // finds nothing, it retries once FrookyAgent.targetReady resolves (in spawn mode: on the app's main thread before
  // app code runs), and only then starts the timeout.
  protected async pollUntilResolved<T>(fn: () => T | null, label: string, timeoutSeconds: number): Promise<T> {
    if (timeoutSeconds < 0) throw Error(`Timeout must not be less than 0.`);
    let deadline: number | undefined;
    for (;;) {
      const result = fn();
      if (result !== null) return result;
      if (deadline === undefined) {
        await this.frookyAgent.targetReady;
        deadline = Date.now() + timeoutSeconds * 1000;
        continue;
      }
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, HOOK_LOOKUP_INTERVAL_MS));
    }
    throw Error(`${label} not found within ${timeoutSeconds} seconds. Skipping the hooks declared for it.`);
  }

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

    const value = decodedValue.value;

    if (typeof value !== "string" && typeof value !== "number") return true;

    const stringValue = String(value);
    return argFilter.some((pattern) => pattern.test(stringValue));
  }

  // At debug level logs e.g. `Decoded com.example.Foo.bar param #0 'key' (java.lang.String, PrimitiveDecoder): "abc"`,
  // where `what` is `com.example.Foo.bar param #0 'key'`.
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
