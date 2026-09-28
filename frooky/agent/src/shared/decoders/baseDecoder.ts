import { Decodable } from "./decodable";
import { DecodedValue } from "./decodedValue";
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

  // `arg` is the decoded value of the param named by `decoderArg`
  public abstract decode(value: TValue, arg?: any): DecodedValue;
}
