import Java from "frida-java-bridge";
import { RecursiveDecoder } from "../../../../shared/decoders/recursiveDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { GetterDecoder } from "../../builtin/GetterDecoder";
import { IntentFlagDecoder } from "./IntentFlagDecoder";

// Decodes an Intent's public getters via GetterDecoder, with `flags` decoded to its FLAG_* names.
export class IntentDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "IntentDecoder";
  readonly description = "Decodes an `android.content.Intent`: its getters (action, data, component, extras, ...) and its flags as `FLAG_*` names.";

  protected decodeRecursive(value: Java.Wrapper): DecodedValue {
    // the wrapper can be typed as a supertype (e.g. Object or Parcelable), so cast it to Intent first. The getters are
    // those of Intent, also for a subclass such as LabeledIntent.
    const intent = Java.cast(value, Java.use("android.content.Intent"));

    const properties = new GetterDecoder({ type: "android.content.Intent", settings: this.settings }, "android.content.Intent").decode(intent)
      .value as DecodedValue[];

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
