import type Java from "frida-java-bridge";
import { RecursiveDecoder } from "../../../shared/decoders/recursiveDecoder";
import { Decodable } from "../../../shared/decoders/decodable";
import { DecoderSettings } from "../../../shared/frookySettings";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DecoderArgValues, logDecodeFailure, sliceBounds } from "../../../shared/decoders/decoderArgs";
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

// Size in bytes of a primitive array element, by its type or JNI signature
function primitiveSize(elementType: string): number {
  switch (elementType.replace(/^\[/, "")) {
    case "B":
    case "byte":
    case "Z":
    case "boolean":
      return 1;
    case "S":
    case "short":
    case "C":
    case "char":
      return 2;
    case "J":
    case "long":
    case "D":
    case "double":
      return 8;
    default:
      return 4;
  }
}

// Reads `decodeLen` primitive array elements from index `start` in bulk via JNI withElements to avoid per-element
// JNI pinning.
export function decodePrimitiveArray(value: any, elementType: string, decodeLen: number, start: number = 0): unknown[] {
  if (decodeLen === 0) {
    return [];
  }

  if (typeof value?.withElements === "function") {
    return value.withElements((arrayElements: NativePointer) => {
      const elements = arrayElements.add(start * primitiveSize(elementType));
      switch (elementType) {
        case "B":
        case "[B":
        case "byte": {
          const raw = elements.readByteArray(decodeLen);
          return raw !== null ? Array.from(new Int8Array(raw)) : [];
        }
        case "I":
        case "[I":
        case "int": {
          const raw = elements.readByteArray(decodeLen * 4);
          return raw !== null ? Array.from(new Int32Array(raw)) : [];
        }
        case "Z":
        case "[Z":
        case "boolean": {
          const raw = elements.readByteArray(decodeLen);
          if (raw === null) return [];
          const u8 = new Uint8Array(raw);
          const result = new Array<boolean>(decodeLen);
          for (let i = 0; i < decodeLen; i++) {
            result[i] = u8[i] !== 0;
          }
          return result;
        }
        case "S":
        case "[S":
        case "short": {
          const raw = elements.readByteArray(decodeLen * 2);
          return raw !== null ? Array.from(new Int16Array(raw)) : [];
        }
        case "F":
        case "[F":
        case "float": {
          const raw = elements.readByteArray(decodeLen * 4);
          return raw !== null ? Array.from(new Float32Array(raw)) : [];
        }
        case "D":
        case "[D":
        case "double": {
          const raw = elements.readByteArray(decodeLen * 8);
          return raw !== null ? Array.from(new Float64Array(raw)) : [];
        }
        case "C":
        case "[C":
        case "char": {
          const raw = elements.readByteArray(decodeLen * 2);
          if (raw === null) return [];
          const u16 = new Uint16Array(raw);
          const result = new Array<string>(decodeLen);
          for (let i = 0; i < decodeLen; i++) {
            result[i] = String.fromCharCode(u16[i]);
          }
          return result;
        }
        case "J":
        case "[J":
        case "long": {
          const result = new Array<unknown>(decodeLen);
          for (let i = 0; i < decodeLen; i++) {
            result[i] = elements.add(i * 8).readS64();
          }
          return result;
        }
      }
      return [];
    });
  }

  const result = new Array(decodeLen);
  for (let i = 0; i < decodeLen; i++) {
    result[i] = value[start + i];
  }
  return result;
}

export class ArrayDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "ArrayDecoder";
  readonly description =
    "Decodes a Java array element by element, up to `maxItems` elements. The roles `offset` and `length` select a slice, e.g. of `SecretKeySpec(byte[] key, int offset, int len, String algorithm)`.";

  public decode(value: Java.Wrapper, args?: DecoderArgValues): DecodedValue {
    // checked before the depth limit, so null is never reported as truncated
    if (value == null) {
      return { type: this.type, name: this.name, value: null };
    }
    return super.decode(value, args);
  }

  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings, args?: DecoderArgValues): DecodedValue {
    const signature = this.type;
    const elementSignature = signature.startsWith("[") ? signature.substring(1) : signature;
    const elementType = elementTypeFromSignature(elementSignature);
    const arrayLike = value as unknown as ArrayLike<unknown>;
    const maxItems = this.settings.maxItems;
    let start: number;
    let end: number;
    try {
      ({ start, end } = sliceBounds(args, arrayLike.length));
    } catch (e) {
      logDecodeFailure(`Unable to decode ${this.type}${this.name ? ` '${this.name}'` : ""}`, e);
      return { type: this.type, name: this.name, value: null };
    }
    const total = end - start;
    const decodeLen = Math.min(total, maxItems);
    let arrayValue: unknown[];

    if (JAVA_PRIMITIVE_TYPES.has(elementType)) {
      arrayValue = decodePrimitiveArray(value, elementType, decodeLen, start);
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
        const el = value[start + i];
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
