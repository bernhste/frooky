import type Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { decodeGetterValues } from "../utils/decodeGetterValues";

export class PrimitiveDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    return {
      type: this.decodable.type,
      name: this.decodable.name,
      value: this.needsUnwrap() && value != null ? value.toString() : value,
    };
  }

  private needsUnwrap(): boolean {
    return this.decodable.type === "long" || this.decodable.type === "java.lang.String";
  }
}

export class GetterDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    return {
      type: this.decodable.type,
      name: this.decodable.name,
      value: decodeGetterValues(value, ["get"], this.decodable.settings),
    };
  }
}

/**
 * Decodes reflection metadata (`java.lang.Class`, `Method`, `Field`, `Constructor`) as its
 * `toString()` instead of reflecting its own getters like {@link GetterDecoder} does. These
 * types point back at each other (a `Method`'s `getDeclaringClass()` returns the very `Class` whose
 * `getDeclaredMethods()` produced it), so getter-reflecting one crashes the Frida script by
 * exhausting the native call stack in unbounded mutual recursion.
 */
export class JavaReflectionMetadataDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    return {
      type: this.decodable.type,
      name: this.decodable.name,
      value: value.toString(),
    };
  }
}
