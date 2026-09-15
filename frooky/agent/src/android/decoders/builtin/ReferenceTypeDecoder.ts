import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { logger } from "../../../shared/logger";
import { ClipDataDecoder } from "../android/content/clipData/ClipDataDecoder";
import { ClipDataItemDecoder } from "../android/content/clipData/ClipDataItemDecoder";
import { ContentValuesDecoder } from "../android/content/ContentValuesDecoder";
import { BundleDecoder } from "../android/os/BundleDecoder";
import { KeyGenParameterSpecDecoder } from "../android/security/keystore/KeyGenParameterSpecDecoder";
import { IterableDecoder } from "../java/lang/IterableDecoder";
import { MapDecoder } from "../java/util/MapDecoder";
import { DecoderConstructor } from "../javaDecoderResolver";
import { JavaReflectionMetadataDecoder, PrimitiveDecoder } from "./BasicDecoder";
import { ToStringDecoder } from "./ToStringDecoder";

// reflecting getters via GetterDecoder of objects of these classes recurses
const REFLECTION_RECURSION_CLASSES = new Set([
  "java.lang.Class",
  "java.lang.reflect.Method",
  "java.lang.reflect.Field",
  "java.lang.reflect.Constructor",
]);

// objects of these classes are decoded using their toString() method. This is helpful, if there are no useful getters.
const TO_STRING_CLASSES = new Set(["javax.security.auth.x500.X500Principal", "java.math.BigInteger", "java.util.Date"]);

let classDecoderRegistry: Record<string, DecoderConstructor> | undefined;
function getClassDecoderRegistry(): Record<string, DecoderConstructor> {
  return (classDecoderRegistry ??= {
    "android.content.ClipData": ClipDataDecoder,
    "android.content.ClipData$Item": ClipDataItemDecoder,
    "android.os.Bundle": BundleDecoder,
    "android.security.keystore.KeyGenParameterSpec": KeyGenParameterSpecDecoder,
    "android.content.ContentValues": ContentValuesDecoder,
  });
}

let interfaceDecoderRegistry: Record<string, DecoderConstructor> | undefined;
function getInterfaceDecoderRegistry(): Record<string, DecoderConstructor> {
  return (interfaceDecoderRegistry ??= {
    "java.util.Map": MapDecoder,
    "java.lang.Iterable": IterableDecoder,
  });
}

const decoderCache = new Map<string, DecoderConstructor>();

function collectInterfaces(javaClass: Java.Wrapper): Set<string> {
  const result = new Set<string>();

  while (javaClass !== null) {
    try {
      const ifaces: Java.Wrapper[] = javaClass.getInterfaces();
      for (const iface of ifaces) {
        const name: string = iface.getName();
        if (!result.has(name)) {
          result.add(name);
          for (const n of collectInterfaces(iface)) result.add(n);
        }
      }
      javaClass = javaClass.getSuperclass();
    } catch (e) {
      logger.warn(`Error when resolving interfaces for class ${javaClass.$className}: ${e}`);
      break;
    }
  }

  return result;
}

function resolveInterfaceDecoderClass(value: Java.Wrapper): DecoderConstructor | null {
  const cachedDecoder = decoderCache.get(value.$className);
  if (cachedDecoder !== undefined) return cachedDecoder;

  const interfaces = collectInterfaces(value.class);
  const registry = getInterfaceDecoderRegistry();
  for (const iface of interfaces) {
    const interfaceDecoder = registry[iface];
    if (interfaceDecoder) {
      decoderCache.set(value.$className, interfaceDecoder);
      return interfaceDecoder;
    }
  }

  return null;
}

export class ReferenceTypeDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    if (value == null) {
      // frida-java-bridge hands back a plain JS null for a null Java reference crossing the
      // bridge, and any declared type that isn't a primitive/String/void/array can legitimately
      // be null (e.g. an Object-typed return value) - decode it as null instead of crashing on
      // $className
      return {
        type: this.decodable.type,
        name: this.decodable.name,
        value: null,
      };
    }

    logger.debug(`Resolving decoder for declared type: ${this.decodable.type}`);

    const decoderConstructor: DecoderConstructor =
      // 1. instances of these classes are always decoded using toString()
      (TO_STRING_CLASSES.has(value.$className) ? ToStringDecoder : undefined) ??
      // 2. reflection metadata is self-referential (see REFLECTION_RECURSION_CLASSES) - decode it via
      // toString() instead of reflecting its getters through GetterDecoder
      (REFLECTION_RECURSION_CLASSES.has(value.$className) ? JavaReflectionMetadataDecoder : undefined) ??
      // 3. java.lang.String is final and already unwrapped by Frida to a JS-friendly value - decode
      // it as a primitive rather than falling through to GetterDecoder, which would otherwise
      // reflect and invoke its getters (e.g. getBytes()) instead of using the string itself
      (value.$className === "java.lang.String" ? PrimitiveDecoder : undefined) ??
      // 4. class decoder for the runtime class exists
      getClassDecoderRegistry()[value.$className] ??
      // 5. interface decoder for declared interface type exists
      getInterfaceDecoderRegistry()[this.decodable.type] ??
      // 6. resolve the interfaces and use a decoder if implemented
      resolveInterfaceDecoderClass(value) ??
      // 7. try to string decode it as a fallback
      ToStringDecoder;

    const decoder = new decoderConstructor({
      type: value.$className,
      name: this.decodable.name,
      settings: this.decodable.settings,
    });

    return {
      type: this.decodable.type,
      name: this.decodable.name,
      value: decoder.decode(value),
    };
  }
}
