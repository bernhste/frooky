import { Decoder } from "./baseDecoder";
import { DecodedValue } from "./decodedValue";
import { DecoderSettings } from "../frookySettings";

export const MAX_DEPTH_MARKER = "[max depth reached]";

// `maxDepth` counts the container levels left to expand, so each level down gets one less.
export function childSettings(settings: DecoderSettings): DecoderSettings {
  return { ...settings, maxDepth: settings.maxDepth - 1 };
}

// Only containers check it, leaf values (primitives, strings, ...) are always decoded.
export function isMaxDepthReached(settings: DecoderSettings): boolean {
  return settings.maxDepth <= 0;
}

// Base class of decoders for values that contain other values (arrays, maps, bundles, ...). Once no depth is
// left, the value is replaced by MAX_DEPTH_MARKER. Leaf decoders extend Decoder directly.
export abstract class RecursiveDecoder<TValue> extends Decoder<TValue> {
  public decode(value: TValue, arg?: any): DecodedValue {
    if (isMaxDepthReached(this.settings)) {
      return { type: this.type, name: this.name, value: MAX_DEPTH_MARKER };
    }
    return this.decodeRecursive(value, childSettings(this.settings), arg);
  }

  // `childSettings` are for the elements, one level deeper. A decoder that delegates its own level to another
  // decoder (e.g. a map to its key set) passes `this.settings` instead.
  protected abstract decodeRecursive(value: TValue, childSettings: DecoderSettings, arg?: any): DecodedValue;
}
