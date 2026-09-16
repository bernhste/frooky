import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../decoders/baseDecoder";
import { Direction, Param, RetType } from "../decoders/decodable";
import { DecodedValue } from "../decoders/decodedValue";
import { DecoderResolver } from "../decoders/decoderResolver";
import { HOOK_LOOKUP_INTERVAL_MS } from "../defaultValues";
import { logger } from "../logger";
import { PlatformStackTrace } from "../platformStackTrace";
import { FilterMismatchError } from "../utils";
import { Hook } from "./hook";

export type ParamDecoder<TValue> = {
  decoder: Decoder<TValue>;
  argIndex: number;
  direction: Direction;
  name?: string;
  decoderArg?: string;
  decoderArgIndex?: number;
  decoderArgDecoder?: Decoder<TValue>;
  paramFilter?: string[];
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

  public abstract resolveHooks(inputHooks: TInputHook[], timeout: number): Promise<Promise<THooks[] | null>[]>;
  public abstract registerHooks(hooks: THooks[]): number;

  protected async pollUntilResolved<T>(fn: () => T | null, label: string, timeoutSeconds: number): Promise<T> {
    if (timeoutSeconds < 0) throw Error(`Timeout must not be less than 0.`);
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const result = fn();
      if (result !== null) return result;
      await new Promise((r) => setTimeout(r, HOOK_LOOKUP_INTERVAL_MS));
    }
    throw Error(`frida resolver timed out resolving '${label}' after ${timeoutSeconds} seconds.`);
  }

  protected resolveParamDecoders(params: Param[]): ParamDecoder<TValue>[] {
    const argDecoderSpecs: ParamDecoder<TValue>[] = [];

    params.forEach((param: Param, paramIndex: number) => {
      const decoderArgResolution = param.settings.decoderArg ? this.resolveDecoderArg(param, paramIndex, params) : undefined;
      if (param.settings.decoderArg && !decoderArgResolution) {
        return; // invalid decoderArg reference; warning already logged by resolveDecoderArg()
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
        paramFilter: param.settings.paramFilter,
      };
      logger.debug(`Decoder for param '${param.type} ${param.name}' resolved: ${JSON.stringify(paramDecoder, null, 2)}`);
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

    const decoder = this.decoderResolver.resolveDecoder({ type: params[index].type, settings: param.settings });
    return { index, decoder };
  }

  protected resolveRetTypeDecoder(retType: RetType): Decoder<TValue> {
    return this.decoderResolver.resolveDecoder(retType);
  }

  protected matchesFilter(decodedValue: DecodedValue, paramFilter?: string[]): boolean {
    if (!paramFilter || paramFilter.length === 0) return true;

    const value = decodedValue.value;

    if (typeof value !== "string" && typeof value !== "number") return true;

    return paramFilter.some((pattern) => new RegExp(pattern).test(String(value)));
  }

  protected decodeArgs(args: TValue[], paramDecoders: ParamDecoder<TValue>[]): DecodedValue[] {
    const decodedArgs: DecodedValue[] = [];
    for (const paramDecoder of paramDecoders) {
      let decodedDecoderArg: any;
      if (paramDecoder.decoderArg && paramDecoder.decoderArgIndex !== undefined && paramDecoder.decoderArgDecoder) {
        // decode the decoder argument
        const decoderArgDecoderSpec = paramDecoders.filter((argDecoder) => argDecoder.name === paramDecoder.name);
        if (decoderArgDecoderSpec.length != 1) {
          throw Error(`It was not possible fetching the decoder for decoderArg '${paramDecoder.decoderArg}'`);
        }
        decodedDecoderArg = paramDecoder.decoderArgDecoder.decode(args[paramDecoder.decoderArgIndex]);
      }
      var decodedValue = paramDecoder.decoder.decode(args[paramDecoder.argIndex], decodedDecoderArg);
      if (this.matchesFilter(decodedValue, paramDecoder.paramFilter)) {
        decodedArgs.push(decodedValue);
      } else {
        throw new FilterMismatchError();
      }
    }

    return decodedArgs;
  }
}
