import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { loadJavaIntConstants } from "../../javaGetConstants";

export class IntentUriFlagDecoder extends Decoder<Java.Wrapper> {
  flags = loadJavaIntConstants("android.content.Intent", "URI_");

  decode(value: Java.Wrapper): DecodedValue {
    const bitmask = Number(value) >>> 0;
    const decodedFlags: string[] = [];
    const seenBits = new Set<number>();

    for (const { name, value: flag } of this.flags) {
      if (flag === 0) continue;
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
