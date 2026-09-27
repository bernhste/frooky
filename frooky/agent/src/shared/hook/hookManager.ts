import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../decoders/baseDecoder";
import { Direction, Param, RetType } from "../decoders/decodable";
import { DecodedValue } from "../decoders/decodedValue";
import { DecoderResolver } from "../decoders/decoderResolver";
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

  /**
   * Resolves the given input hooks. The returned promises are index-aligned with `inputHooks`:
   * the n-th promise yields the resolved hooks of the n-th input hook, or `null` if it failed.
   * `source` names where the hooks are declared (the hook file) in log messages.
   */
  public abstract resolveHooks(inputHooks: TInputHook[], timeout: number, source?: string): Promise<Promise<THooks[] | null>[]>;
  /**
   * Installs the hooks and logs each installed one. Returns how many were installed; failures are logged and skipped.
   * `source` names where the hooks are declared (the hook file) in log messages.
   */
  public abstract registerHooks(hooks: THooks[], source?: string): number;
  /** Removes hooks previously installed by {@link registerHooks}. Hooks that were never installed are ignored. */
  public abstract unregisterHooks(hooks: THooks[]): void;

  /**
   * Polls `fn` until it returns a value. `label` names what is looked up in the timeout error, e.g. `Module 'libfoo.so'`.
   *
   * If the first call finds nothing, the target's own code may not be loaded yet (in spawn mode the app is still
   * paused), so it retries once {@link FrookyAgent.targetReady} resolves and only then starts the timeout. In spawn
   * mode that retry runs on the app's main thread before the app's code runs, so what it finds is hooked in time.
   */
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

    // the referenced param's own settings: the referencing param's settings may name a custom decoder
    // (e.g. `decoder: string` on a buffer) that must not be applied to the length it references
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

  /**
   * Decodes one value. At debug level, logs what went in (the declared type), the decoder and what came
   * out, e.g. `Decoded com.example.Foo.bar param #0 'key' (java.lang.String, PrimitiveDecoder): "abc"`.
   *
   * @param what - Names the value in the log message, e.g. `com.example.Foo.bar return value`.
   */
  protected decodeValue(decoder: Decoder<TValue>, value: TValue, what: string, arg?: any): DecodedValue {
    const decodedValue = decoder.decode(value, arg);
    // checked first, since previewValue() serializes the whole (possibly large) decoded value
    if (logger.isEnabled("debug")) {
      logger.debug(`Decoded ${what} (${decoder.declaredType}, ${decoder.decoderName}): ${previewValue(decodedValue.value)}`);
    }
    return decodedValue;
  }

  /**
   * Decodes the arguments of one call.
   *
   * @param target - The hooked method or function, only used in debug log messages.
   */
  protected decodeArgs(args: TValue[], paramDecoders: ParamDecoder<TValue>[], target: string = "hook"): DecodedValue[] {
    const decodedArgs: DecodedValue[] = [];
    for (const paramDecoder of paramDecoders) {
      const param = `${target} param #${paramDecoder.argIndex}${paramDecoder.name ? ` '${paramDecoder.name}'` : ""}`;
      let decodedDecoderArg: any;
      if (paramDecoder.decoderArg && paramDecoder.decoderArgIndex !== undefined && paramDecoder.decoderArgDecoder) {
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
