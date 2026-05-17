import { Decoder } from "../decoders/baseDecoder";
import { Direction, Param, RetType } from "../decoders/decodable";
import { DecodedValue } from "../decoders/decodedValue";
import { DecoderResolver } from "../decoders/decoderResolver";
import { HOOK_LOOKUP_INTERVAL_MS } from "../defaultValues";
import { Hook } from "./hook";

export type ArgDecoderSpec<TValue> = {
  decoder: Decoder<TValue>;
  argIndex: number;
  direction: Direction;
  name?: string;
  decoderArg?: string;
  decoderArgIndex?: number;
  decoderArgDecoder?: Decoder<TValue>;
};

export type DecodedArgs = {
  in?: DecodedValue[];
  out?: DecodedValue[];
};

export abstract class HookManager<TInputHook, THooks extends Hook, TValue> {
  constructor(private readonly decoderResolver: DecoderResolver<TValue>) {}

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

  protected resolveArgDecoders(params: Param[]): ArgDecoderSpec<TValue>[] {
    const argDecoderSpecs: ArgDecoderSpec<TValue>[] = [];

    params.forEach((param: Param, i: number) => {
      let decoderArgIndex: number | undefined;
      let decoderArgDecoder: Decoder<TValue> | undefined;
      const { direction, ...decodable } = param;
      if (param.settings.decoderArg) {
        decoderArgIndex = params.findIndex((p) => p.name === param.settings.decoderArg);
        decoderArgDecoder = this.decoderResolver.resolveDecoder({
          type: params.find((p) => p.name === param.settings.decoderArg)!.type,
          settings: param.settings,
        });
      }
      argDecoderSpecs.push({
        decoder: this.decoderResolver.resolveDecoder(decodable),
        argIndex: i,
        direction: param.direction,
        name: param.name,
        decoderArg: param.settings.decoderArg,
        decoderArgIndex: decoderArgIndex,
        decoderArgDecoder: decoderArgDecoder,
      });
    });
    return argDecoderSpecs;
  }

  protected resolveRetTypeDecoder(retType: RetType): Decoder<TValue> {
    return this.decoderResolver.resolveDecoder(retType);
  }

  protected decodeArgs(args: TValue[], argDecoderSpecs: ArgDecoderSpec<TValue>[]): DecodedValue[] {
    const decodedArgs: DecodedValue[] = [];
    for (const argDecoderSpec of argDecoderSpecs) {
      let decodedDecoderArg: any;
      if (argDecoderSpec.decoderArg && argDecoderSpec.decoderArgIndex && argDecoderSpec.decoderArgDecoder) {
        // decode the decoder argument
        const decoderArgDecoderSpec = argDecoderSpecs.filter((ardDecoder) => ardDecoder.name === argDecoderSpec.name);
        if (decoderArgDecoderSpec.length != 1) {
          throw Error(`It was not possible fetching the decoder for decoderArg '${argDecoderSpec.decoderArg}'`);
        }
        decodedDecoderArg = argDecoderSpec.decoderArgDecoder.decode(args[argDecoderSpec.decoderArgIndex]);
      }
      decodedArgs.push(argDecoderSpec.decoder.decode(args[argDecoderSpec.argIndex], decodedDecoderArg));
    }

    return decodedArgs;
  }
}
