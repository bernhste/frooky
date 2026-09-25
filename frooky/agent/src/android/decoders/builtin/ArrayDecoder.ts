import type Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { Decodable } from "../../../shared/decoders/decodable";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { JAVA_PRIMITIVE_TYPES, JavaDecoderResolver } from "../javaDecoderResolver";

/**
 * Convert a JNI array element signature into a JavaParam-compatible `type` string.
 *   "I"                  -> "int"
 *   "J"                  -> "long"
 *   "Ljava/lang/String;" -> "java.lang.String"
 *   "Ljava.lang.String;" -> "java.lang.String"
 *   "[I"                 -> "[I"   (nested array, kept as-is)
 */
function elementTypeFromSignature(element: string): string {
  if (element.length === 1) {
    switch (element) {
      case "Z":
        return "boolean";
      case "B":
        return "byte";
      case "C":
        return "char";
      case "S":
        return "short";
      case "I":
        return "int";
      case "J":
        return "long";
      case "F":
        return "float";
      case "D":
        return "double";
    }
  }
  if (element.startsWith("[")) {
    return element;
  }
  if (element.startsWith("L") && element.endsWith(";")) {
    return element.substring(1, element.length - 1).replace(/\//g, ".");
  }
  return element;
}

export class ArrayDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    const signature = this.type;
    const elementSignature = signature.startsWith("[") ? signature.substring(1) : signature;
    const elementType = elementTypeFromSignature(elementSignature);
    const arrayLike = value as unknown as ArrayLike<unknown>;
    const maxItems = this.settings.maxItems;
    const total: number = arrayLike.length;
    const decodeLen = Math.min(total, maxItems);
    let arrayValue: unknown[];

    if (JAVA_PRIMITIVE_TYPES.has(elementType)) {
      // Frida unwraps primitive arrays to a native-memory-backed proxy - index reads are direct
      // memory reads, not bridge calls, so capping at maxItems here is about bounding the
      // resulting JS array/payload size rather than avoiding bridge crossings
      arrayValue = new Array(decodeLen);
      for (let i = 0; i < decodeLen; i++) {
        arrayValue[i] = arrayLike[i];
      }
    } else {
      // complex java types or nested array
      const elementDecodable: Decodable = {
        type: elementType,
        name: this.name,
        settings: this.settings,
      };
      const elementDecoder = JavaDecoderResolver.resolveDecoder(elementDecodable);
      arrayValue = new Array(decodeLen);
      for (let i = 0; i < decodeLen; i++) {
        const el = value[i];
        arrayValue[i] = el == null ? null : elementDecoder.decode(el).value;
      }
    }

    if (total > decodeLen) {
      arrayValue.push(`[truncated at ${maxItems}]`);
    }

    return {
      type: this.type,
      name: this.name,
      value: arrayValue,
    };
  }
}
