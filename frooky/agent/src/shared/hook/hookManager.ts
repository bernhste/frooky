import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../decoders/baseDecoder";
import { Direction, Param, RetType } from "../decoders/decodable";
import { DecodedValue } from "../decoders/decodedValue";
import { DecoderResolver } from "../decoders/decoderResolver";
import { RETURN_VALUE_DECODER_ARG } from "../inputParsing/inputDecodableTypes";
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
  decoderArg?: string;
  decoderArgIndex?: number;
  decoderArgDecoder?: Decoder<TValue>;
  // `decoderArg: $ret`: the decoded return value is passed instead of another parameter
  decoderArgIsReturnValue?: boolean;
  argFilter?: RegExp[];
};

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

  protected resolveParamDecoders(params: Param[]): ParamDecoder<TValue>[] {
    const argDecoderSpecs: ParamDecoder<TValue>[] = [];

    params.forEach((param: Param, paramIndex: number) => {
      const decoderArgIsReturnValue = param.settings.decoderArg === RETURN_VALUE_DECODER_ARG;
      const decoderArgResolution =
        param.settings.decoderArg && !decoderArgIsReturnValue ? this.resolveDecoderArg(param, paramIndex, params) : undefined;
      if (param.settings.decoderArg && !decoderArgIsReturnValue && !decoderArgResolution) {
        return; // invalid decoderArg, logged by resolveDecoderArg()
      }

      const { direction, ...paramDecodable } = param;
      const paramDecoder: ParamDecoder<TValue> = {
        decoder: this.decoderResolver.resolveDecoder(paramDecodable),
        argIndex: paramIndex,
        direction: param.direction,
        name: param.name,
        decoderArg: param.settings.decoderArg,
        decoderArgIndex: decoderArgResolution?.index,
        decoderArgDecoder: decoderArgResolution?.decoder,
        decoderArgIsReturnValue,
        argFilter: param.settings.argFilter?.map((pattern) => new RegExp(pattern)),
      };
      logger.debug(
        `Decoder for param '${param.type} ${param.name}' resolved: ${JSON.stringify({ ...paramDecoder, decoder: paramDecoder.decoder.decoderName, settings: param.settings }, null, 2)}`,
      );
      argDecoderSpecs.push(paramDecoder);
    });

    return argDecoderSpecs;
  }

  protected resolveDecoderArg(param: Param, paramIndex: number, params: Param[]): { index: number; decoder: Decoder<TValue> } | undefined {
    const decoderArgName = param.settings.decoderArg!;
    const index = params.findIndex((p) => p.name === decoderArgName);
    const otherParamNames = params
      .filter((p) => p.name !== param.name)
      .map((p) => p.name)
      .join(", ");

    if (index < 0) {
      logger.warn(
        `Decoder argument (${decoderArgName}) is not a valid parameter. Make sure to choose form one of the following parameter: ${otherParamNames} `,
      );
      return undefined;
    }

    if (index === paramIndex) {
      logger.warn(
        `Decoder argument (${decoderArgName}) cannot be itself. Make sure to choose form one of the following parameter: ${otherParamNames} `,
      );
      return undefined;
    }

    // with the referenced param's own settings, not e.g. the `decoder: string` of the buffer referencing it
    const decoder = this.decoderResolver.resolveDecoder({ type: params[index].type, settings: params[index].settings });
    return { index, decoder };
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
  protected decodeValue(decoder: Decoder<TValue>, value: TValue, what: string, arg?: any): DecodedValue {
    const decodedValue = decoder.decode(value, arg);
    // previewValue() serializes the whole decoded value
    if (logger.isEnabled("debug")) {
      logger.debug(`Decoded ${what} (${decoder.declaredType}, ${decoder.decoderName}): ${previewValue(decodedValue.value)}`);
    }
    return decodedValue;
  }

  // Throws FilterMismatchError if an argument doesn't match its argFilter. `target` is for debug logs. `returnValue`
  // is the decoded return value for `decoderArg: $ret`, only known when decoding `out` parameters.
  protected decodeArgs(args: TValue[], paramDecoders: ParamDecoder<TValue>[], target: string = "hook", returnValue?: DecodedValue): DecodedValue[] {
    const decodedArgs: DecodedValue[] = [];
    for (const paramDecoder of paramDecoders) {
      const param = `${target} param #${paramDecoder.argIndex}${paramDecoder.name ? ` '${paramDecoder.name}'` : ""}`;
      let decodedDecoderArg: any;
      if (paramDecoder.decoderArgIsReturnValue) {
        decodedDecoderArg = returnValue;
      } else if (paramDecoder.decoderArg && paramDecoder.decoderArgIndex !== undefined && paramDecoder.decoderArgDecoder) {
        decodedDecoderArg = this.decodeValue(
          paramDecoder.decoderArgDecoder,
          args[paramDecoder.decoderArgIndex],
          `decoderArg '${paramDecoder.decoderArg}' of ${param}`,
        );
      }
      const decodedValue = this.decodeValue(paramDecoder.decoder, args[paramDecoder.argIndex], param, decodedDecoderArg);
      if (this.matchesFilter(decodedValue, paramDecoder.argFilter)) {
        decodedArgs.push(decodedValue);
      } else {
        throw new FilterMismatchError();
      }
    }

    return decodedArgs;
  }
}
