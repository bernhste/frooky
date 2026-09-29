import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { RecursiveDecoder } from "../../../../shared/decoders/recursiveDecoder";
import { DecoderSettings } from "../../../../shared/frookySettings";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { JavaDecoderResolver } from "../../javaDecoderResolver";

let javaMap: Java.Wrapper | undefined;
function getJavaMap(): Java.Wrapper {
  return (javaMap ??= Java.use("java.util.Map"));
}

let javaMapEntry: Java.Wrapper | undefined;
function getJavaMapEntry(): Java.Wrapper {
  return (javaMapEntry ??= Java.use("java.util.Map$Entry"));
}

interface MapClassViews {
  keySetClassName: string;
  valuesClassName: string;
}
const mapViewsCache = new Map<string, MapClassViews>();

function getMapViews(map: Java.Wrapper): MapClassViews {
  const className = map.$className;
  let views = mapViewsCache.get(className);
  if (!views) {
    views = {
      keySetClassName: map.keySet().$className,
      valuesClassName: map.values().$className,
    };
    mapViewsCache.set(className, views);
  }
  return views;
}

export class MapDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "MapDecoder";
  readonly description = "Decodes any `java.util.Map` into its keys and values, up to `maxItems` entries.";

  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings): DecodedValue {
    const map = Java.cast(value, getJavaMap());
    const views = getMapViews(map);

    const maxItems = this.settings.maxItems;
    const entrySet = map.entrySet();
    const iterator: Java.Wrapper = entrySet.iterator();

    const keyValues: DecodedValue[] = [];
    const valValues: DecodedValue[] = [];

    const keyDecoderCache = new Map<string, Decoder<Java.Wrapper>>();
    const valDecoderCache = new Map<string, Decoder<Java.Wrapper>>();

    let count = 0;
    while (iterator.hasNext() && count < maxItems) {
      const entry = Java.cast(iterator.next(), getJavaMapEntry());
      const k = entry.getKey();
      const v = entry.getValue();

      if (k === null) {
        keyValues.push({ type: "null", name: this.name, value: null });
      } else {
        const kClassName = k.$className;
        let kDecoder = keyDecoderCache.get(kClassName);
        if (!kDecoder) {
          kDecoder = JavaDecoderResolver.resolveDecoder({
            type: kClassName,
            name: this.name,
            settings: childSettings,
          });
          keyDecoderCache.set(kClassName, kDecoder);
        }
        keyValues.push(kDecoder.decode(k));
      }

      if (v === null) {
        valValues.push({ type: "null", name: this.name, value: null });
      } else {
        const vClassName = v.$className;
        let vDecoder = valDecoderCache.get(vClassName);
        if (!vDecoder) {
          vDecoder = JavaDecoderResolver.resolveDecoder({
            type: vClassName,
            name: this.name,
            settings: childSettings,
          });
          valDecoderCache.set(vClassName, vDecoder);
        }
        valValues.push(vDecoder.decode(v));
      }

      count++;
    }

    if (iterator.hasNext()) {
      const truncationMarker: DecodedValue = {
        type: "java.lang.String",
        value: `[truncated at ${maxItems}]`,
      };
      keyValues.push(truncationMarker);
      valValues.push(truncationMarker);
    }

    return {
      type: this.type,
      name: this.name,
      value: [
        { type: views.keySetClassName, name: "key", value: keyValues },
        { type: views.valuesClassName, name: "value", value: valValues },
      ],
    };
  }
}
