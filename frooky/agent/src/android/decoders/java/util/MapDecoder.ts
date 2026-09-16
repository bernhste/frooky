import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { IterableDecoder } from "../lang/IterableDecoder";

export class MapDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    const keySet = value.keySet();
    const decodedKeySet = new IterableDecoder({
      type: keySet.$className,
      name: this.name,
      settings: this.settings,
    }).decode(keySet);

    const valueCollection = value.values();
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
