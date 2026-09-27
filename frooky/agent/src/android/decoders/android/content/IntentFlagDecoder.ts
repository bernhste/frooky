import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { decodeConstantValues } from "../../utils/decodeConstants";

export class IntentFlagDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "IntentFlagDecoder";
  readonly description =
    "Decodes an `int` bitmask of Intent flags to the names of the `Intent.FLAG_*` constants that are set, e.g. `FLAG_ACTIVITY_NEW_TASK`.";

  flags = decodeConstantValues("android.content.Intent", "FLAG_");

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
      type: "android.content.IntentFlag",
      value: decodedFlags,
    };
  }
}
