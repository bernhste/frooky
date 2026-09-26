import { Decoder } from "./baseDecoder";
import { DecodedValue } from "./decodedValue";
import { DecoderSettings } from "../frookySettings";

export const MAX_DEPTH_MARKER = "[max depth reached]";

/**
 * Settings for the children of a container value. `maxDepth` counts the container levels still
 * left to expand, so every level down gets one less.
 */
export function childSettings(settings: DecoderSettings): DecoderSettings {
  return { ...settings, maxDepth: settings.maxDepth - 1 };
}

/**
 * True when a container has no depth left and must not expand its children. Leaf values
 * (primitives, strings, ...) ignore `maxDepth` and are always decoded.
 */
export function isMaxDepthReached(settings: DecoderSettings): boolean {
  return settings.maxDepth <= 0;
}

/**
 * Base class for decoders of values that contain other values (arrays, collections, maps, bundles,
 * objects decoded through their getters, ...) and can therefore nest.
 *
 * Enforces `maxDepth`: once no depth is left, the value is replaced by {@link MAX_DEPTH_MARKER}
 * without calling {@link decodeRecursive}. Leaf decoders extend {@link Decoder} directly.
 *
 * @template TValue - The raw input type to decode.
 */
export abstract class RecursiveDecoder<TValue> extends Decoder<TValue> {
  public decode(value: TValue, arg?: any): DecodedValue {
    if (isMaxDepthReached(this.settings)) {
      return { type: this.type, name: this.name, value: MAX_DEPTH_MARKER };
    }
    return this.decodeRecursive(value, childSettings(this.settings), arg);
  }

  /**
   * Decodes a value that is still within `maxDepth`.
   *
   * @param value - The raw value to decode.
   * @param childSettings - Settings to decode the value's elements with, one level deeper. A decoder
   * that delegates to another decoder for its own level (e.g. a map to its key set) passes
   * `this.settings` instead.
   * @param arg - Arguments passed to the decoder
   */
  protected abstract decodeRecursive(value: TValue, childSettings: DecoderSettings, arg?: any): DecodedValue;
}
