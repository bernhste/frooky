import type Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { Decodable } from "../../../shared/decoders/decodable";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { logger } from "../../../shared/logger";

// Runs the decoder chosen with `decoder:` in the hook file. If it fails on a value (e.g. `decoder: intentFlag` on
// a String), the value is decoded with the default decoder of its declared type, so the event keeps it.
export class OverrideDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName: string;
  readonly description: string | undefined;

  private readonly override: Decoder<Java.Wrapper>;
  private readonly fallback: Decoder<Java.Wrapper>;
  private warned = false;

  constructor(decodable: Decodable, override: Decoder<Java.Wrapper>, fallback: Decoder<Java.Wrapper>) {
    super(decodable);
    this.override = override;
    this.fallback = fallback;
    this.decoderName = override.decoderName;
    this.description = override.description;
  }

  decode(value: Java.Wrapper, arg?: any): DecodedValue {
    try {
      return this.override.decode(value, arg);
    } catch (e) {
      // once per parameter, a hook can fire very often
      const message = `Decoder '${this.settings.decoder}' failed on ${this.type}${this.name ? ` '${this.name}'` : ""}, using ${this.fallback.decoderName}: ${e}`;
      if (this.warned) {
        logger.debug(message);
      } else {
        logger.warn(message);
        this.warned = true;
      }
      return this.fallback.decode(value, arg);
    }
  }
}
