import Java from "frida-java-bridge";
import { RecursiveDecoder } from "../../../../shared/decoders/recursiveDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { IterableDecoder } from "../lang/IterableDecoder";

let javaMap: Java.Wrapper | undefined;
function getJavaMap(): Java.Wrapper {
  return (javaMap ??= Java.use("java.util.Map"));
}

export class MapDecoder extends RecursiveDecoder<Java.Wrapper> {
  protected decodeRecursive(value: Java.Wrapper): DecodedValue {
    // the wrapper can be typed as a supertype without keySet()/values() (e.g. java.lang.Object for an
    // element of a collection), so cast it to Map first
    const map = Java.cast(value, getJavaMap());

    // the key set and value collection are the map's own level, so they get the map's settings, not
    // the child settings - IterableDecoder then decodes the keys and values one level deeper
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
