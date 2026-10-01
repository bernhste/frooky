import { Decodable } from "./decodable";
import { DecodedValue } from "./decodedValue";
import { DecoderArgValues } from "./decoderArgs";
import { DecoderSettings } from "../frookySettings";

export abstract class Decoder<TValue> {
  // for log messages; class names are minified in release builds
  public abstract readonly decoderName: string;
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

  public get declaredType(): string {
    return this.type;
  }

  // `args` are the values of the roles in `decoderArgs`, only set for the roles the decoder accepts
  public abstract decode(value: TValue, args?: DecoderArgValues): DecodedValue;
}
