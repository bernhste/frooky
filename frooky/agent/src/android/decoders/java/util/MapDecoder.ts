import Java from "frida-java-bridge";
import { RecursiveDecoder } from "../../../../shared/decoders/recursiveDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { IterableDecoder } from "../lang/IterableDecoder";

let javaMap: Java.Wrapper | undefined;
function getJavaMap(): Java.Wrapper {
  return (javaMap ??= Java.use("java.util.Map"));
}

export class MapDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "MapDecoder";
  readonly description = "Decodes any `java.util.Map` into its keys and values, up to `maxItems` entries.";

  protected decodeRecursive(value: Java.Wrapper): DecodedValue {
    // the wrapper can be typed as a supertype without keySet()/values() (e.g. java.lang.Object), so cast it first
    const map = Java.cast(value, getJavaMap());

    // the key set and values are on the map's level, so they get the map's settings, not the child settings
    const keySet = map.keySet();
    const decodedKeySet = new IterableDecoder({
      type: keySet.$className,
      name: this.name,
      settings: this.settings,
    }).decode(keySet);

    const valueCollection = map.values();
    const decodedValues = new IterableDecoder({
      type: valueCollection.$className,
      name: this.name,
      settings: this.settings,
    }).decode(valueCollection);

    return {
      type: this.type,
      name: this.name,
      value: [
        { ...decodedKeySet, name: "key" },
        { ...decodedValues, name: "value" },
      ],
    };
  }
}
