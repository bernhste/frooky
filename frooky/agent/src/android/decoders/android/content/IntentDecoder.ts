import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { GetterDecoder } from "../../builtin/GetterDecoder";
import { IntentFlagDecoder } from "./IntentFlagDecoder";

/**
 * Decodes an Intent by reflecting its public getters via {@link GetterDecoder} (action, data, type,
 * package, component, categories, extras, ...), then adding the two things a getter can't give us:
 * the raw flags int decoded to its human-readable FLAG_* names, and the caller info the system
 * attaches to identify who launched it.
 */
export class IntentDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    // value.get(key)-style callers that only know the declared type (Object, Parcelable, ...) hand
    // us a wrapper bound to that narrower type - re-cast to Intent itself so its own getters resolve
    const intent = Java.cast(value, Java.use("android.content.Intent"));

    const properties = new GetterDecoder({ type: "android.content.Intent", settings: this.settings }).decode(intent).value as DecodedValue[];

    const flags = properties.find((property) => property.name === "flags");
    if (flags) {
      const decodedFlags = new IntentFlagDecoder({ type: "int", settings: this.settings }).decode(flags.value as unknown as Java.Wrapper);
      flags.type = decodedFlags.type;
      flags.value = decodedFlags.value;
    }

    return {
      type: "android.content.Intent",
      name: this.name,
      value: properties,
    };
  }
}
