// iterableDecoder.ts
import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { RecursiveDecoder } from "../../../../shared/decoders/recursiveDecoder";
import { DecoderSettings } from "../../../../shared/frookySettings";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { JavaDecoderResolver } from "../../javaDecoderResolver";

let javaIterable: Java.Wrapper | undefined;
function getJavaIterable(): Java.Wrapper {
  return (javaIterable ??= Java.use("java.lang.Iterable"));
}

/**
 * Decode any java.lang.Iterable by walking its iterator().
 */
export class IterableDecoder extends RecursiveDecoder<Java.Wrapper> {
  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings): DecodedValue {
    const values: DecodedValue[] = [];
    // the wrapper can be typed as a supertype without iterator() (e.g. java.lang.Object for an element
    // of another collection), so cast it to Iterable first
    const iterator: Java.Wrapper = Java.cast(value, getJavaIterable()).iterator();
    const maxItems = this.settings.maxItems;

    const decoderCache = new Map<string, Decoder<Java.Wrapper>>();

    let count = 0;
    while (iterator.hasNext() && count < maxItems) {
      const element = iterator.next();
      const className = element.$className;

      let elementDecoder = decoderCache.get(className);
      if (!elementDecoder) {
        elementDecoder = JavaDecoderResolver.resolveDecoder({
          type: className,
          name: this.name,
          settings: childSettings,
        });
        decoderCache.set(className, elementDecoder);
      }

      values.push(elementDecoder.decode(element));
      count++;
    }

    if (iterator.hasNext()) {
      values.push({
        type: "java.lang.String",
        value: `[truncated at ${maxItems}]`,
      } as DecodedValue);
    }

    return {
      type: this.type,
      name: this.name,
      value: values,
    };
  }
}
