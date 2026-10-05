import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { decodeConstantValues } from "../../utils/decodeConstants";

export class IntentUriFlagDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "IntentUriFlagDecoder";
  readonly description =
    "Decodes an `int` bitmask of Intent URI flags (`Intent.toUri()`, `Intent.parseUri()`) to the names of the `Intent.URI_*` constants that are set.";

  flags = decodeConstantValues("android.content.Intent", "URI_*");

  decode(value: Java.Wrapper): DecodedValue {
    const bitmask = Number(value) >>> 0;
    const decodedFlags: string[] = [];
    const seenBits = new Set<number>();

    for (const { type, name, value: flag } of this.flags) {
      if (type !== "int" || !name || flag === 0) continue;
      if ((bitmask & flag) === flag && !seenBits.has(flag)) {
        seenBits.add(flag);
        decodedFlags.push(name);
      }
    }

    return {
      type: "android.content.IntentUriFlag",
      value: decodedFlags,
    };
  }
}
