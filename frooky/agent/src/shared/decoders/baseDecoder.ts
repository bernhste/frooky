import { Decodable } from "./decodable";
import { DecodedValue } from "./decodedValue";
import { DecoderSettings } from "../frookySettings";

/**
 * Base interface for value decoders.
 *
 * @template TValue - The raw input type to decode.
 */
export abstract class Decoder<TValue> {
  /**
   * Names the decoder in log messages, e.g. `IntentFlagDecoder`. Set explicitly because class names
   * are minified in release builds.
   */
  public abstract readonly decoderName: string;
  /** What the decoder does, if the name alone doesn't say it. */
  public readonly description?: string;

  protected decodable: Decodable;
  protected settings: DecoderSettings;
  protected type: string;
  protected name?: string;

  constructor(decodable: Decodable) {
    this.decodable = decodable;
    this.settings = decodable.settings;
    this.type = decodable.type;
    this.name = decodable.name;
  }

  /** The declared type this decoder decodes, e.g. `java.util.List` or `char*`. */
  public get declaredType(): string {
    return this.type;
  }

  /**
   * Decodes a raw value into a {@link DecodedValue}.
   *
   * @param value - The raw value to decode.
   * @param args - Arguments passed to the decoder
   * @returns The decoded representation of `value`.
   */
  public abstract decode(value: TValue, arg?: any): DecodedValue;
}
