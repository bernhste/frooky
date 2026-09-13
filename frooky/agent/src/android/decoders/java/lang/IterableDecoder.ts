// iterableDecoder.ts
import type Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { JavaDecoderResolver } from "../../javaDecoderResolver";

/**
 * Decode any java.lang.Iterable by walking its iterator().
 */
export class IterableDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    const values: DecodedValue[] = [];
    const iterator: Java.Wrapper = value.iterator();
    const decodeLimit = this.decodable.settings.decodeLimit;

    const decoderCache = new Map<string, Decoder<Java.Wrapper>>();

    let count = 0;
    while (iterator.hasNext() && count < decodeLimit) {
      const element = iterator.next();
      const className = element.$className;

      let elementDecoder = decoderCache.get(className);
      if (!elementDecoder) {
        elementDecoder = JavaDecoderResolver.resolveDecoder({
          type: className,
          name: this.decodable.name,
          settings: this.decodable.settings,
        });
        decoderCache.set(className, elementDecoder);
      }

      values.push(elementDecoder.decode(element));
      count++;
    }

    if (iterator.hasNext()) {
      values.push({
        type: "java.lang.String",
        value: `[truncated at ${decodeLimit}]`,
      } as DecodedValue);
    }

    return {
      type: this.decodable.type,
      name: this.decodable.name,
      value: values,
    };
  }
}
