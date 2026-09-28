import type Java from "frida-java-bridge";
import { RecursiveDecoder } from "../../../shared/decoders/recursiveDecoder";
import { Decodable } from "../../../shared/decoders/decodable";
import { DecoderSettings } from "../../../shared/frookySettings";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { JAVA_PRIMITIVE_TYPES, JavaDecoderResolver } from "../javaDecoderResolver";

// JNI array element signature to a declared type:
// "I" -> "int", "Ljava/lang/String;" or "Ljava.lang.String;" -> "java.lang.String", "[I" -> "[I" (nested array)
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

export class ArrayDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "ArrayDecoder";
  readonly description = "Decodes a Java array element by element, up to `maxItems` elements.";

  public decode(value: Java.Wrapper, arg?: any): DecodedValue {
    // checked before the depth limit, so null is never reported as truncated
    if (value == null) {
      return { type: this.type, name: this.name, value: null };
    }
    return super.decode(value, arg);
  }

  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings): DecodedValue {
    const signature = this.type;
    const elementSignature = signature.startsWith("[") ? signature.substring(1) : signature;
    const elementType = elementTypeFromSignature(elementSignature);
    const arrayLike = value as unknown as ArrayLike<unknown>;
    const maxItems = this.settings.maxItems;
    const total: number = arrayLike.length;
    const decodeLen = Math.min(total, maxItems);
    let arrayValue: unknown[];

    if (JAVA_PRIMITIVE_TYPES.has(elementType)) {
      arrayValue = new Array(decodeLen);
      for (let i = 0; i < decodeLen; i++) {
        arrayValue[i] = arrayLike[i];
      }
    } else {
      // reference types and nested arrays
      const elementDecodable: Decodable = {
        type: elementType,
        name: this.name,
        settings: childSettings,
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
