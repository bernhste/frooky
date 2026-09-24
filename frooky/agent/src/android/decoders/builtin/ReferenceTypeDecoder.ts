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
import { StringDecoder } from "./StringDecoder";

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

const decoderCache = new Map<string, DecoderConstructor | null>();

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

  decoderCache.set(value.$className, null);
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
        type: this.type,
        name: this.name,
        value: null,
      };
    }

    logger.debug(`Resolving decoder for declared type: ${this.type}`);

    const decoderConstructor: DecoderConstructor =
      // 1. class decoder for the runtime class exists
      getClassDecoderRegistry()[value.$className] ??
      // 2. interface decoder for declared interface type exists - a fast path that skips the
      // reflective walk in step 3 when the declared type already names a registered interface
      // directly; step 3 alone would resolve the same case (just slower), so if the interface
      // registry ever grows to include two interfaces in a supertype/subtype relationship, make
      // sure both steps still agree on which one wins
      getInterfaceDecoderRegistry()[this.type] ??
      // 3. resolve the interfaces and use a decoder if implemented
      resolveInterfaceDecoderClass(value) ??
      // 4. no specific decoder is registered for this reference type - fall back to its Java
      // toString() rather than reflecting its getters, which needs no per-class allowlist: this
      // is correct for java.lang.String (toString() is itself), for a class with no useful
      // "get"-prefixed methods (e.g. BigInteger), and for reflection metadata like Class/Method/
      // Field, whose own getters point back at each other and would recurse without bound through
      // GetterDecoder - this fallback never calls GetterDecoder, so that recursion can't happen here
      StringDecoder;

    const decoder = new decoderConstructor({
      type: value.$className,
      name: this.name,
      settings: this.settings,
    });

    return {
      type: this.type,
      name: this.name,
      value: decoder.decode(value),
    };
  }
}
