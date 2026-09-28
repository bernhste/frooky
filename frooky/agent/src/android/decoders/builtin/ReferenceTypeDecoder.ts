import Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { logger } from "../../../shared/logger";
import { ClipDataDecoder } from "../android/content/clipData/ClipDataDecoder";
import { ClipDataItemDecoder } from "../android/content/clipData/ClipDataItemDecoder";
import { ContentValuesDecoder } from "../android/content/ContentValuesDecoder";
import { IntentDecoder } from "../android/content/IntentDecoder";
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
    "android.content.Intent": IntentDecoder,
  });
}

let interfaceDecoderRegistry: Record<string, DecoderConstructor> | undefined;
function getInterfaceDecoderRegistry(): Record<string, DecoderConstructor> {
  return (interfaceDecoderRegistry ??= {
    "java.util.Map": MapDecoder,
    "java.lang.Iterable": IterableDecoder,
  });
}

// the interface decoder of a runtime class, or null if none of its interfaces has one
const decoderCache = new Map<string, DecoderConstructor | null>();

// the decoder per `${declaredType}|${runtimeClass}`
const resolvedDecoderCache = new Map<string, DecoderConstructor>();

let javaObject: Java.Wrapper | undefined;
function getJavaObject(): Java.Wrapper {
  return (javaObject ??= Java.use("java.lang.Object"));
}

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
  if (cachedDecoder !== undefined) {
    logger.debug(`Interface decoder cache hit: ${value.$className}`);
    return cachedDecoder;
  }
  logger.debug(`Interface decoder cache miss: ${value.$className}, collecting its interfaces`);

  // getClass() is the runtime class, `.class` would be the wrapper's static type (e.g. java.lang.Object for
  // an element of an Object[]). The cast is needed because a wrapper typed as an interface has no getClass().
  const interfaces = collectInterfaces(Java.cast(value, getJavaObject()).getClass());
  const registry = getInterfaceDecoderRegistry();
  for (const iface of interfaces) {
    const interfaceDecoder = registry[iface];
    if (interfaceDecoder) {
      decoderCache.set(value.$className, interfaceDecoder);
      logger.debug(`${value.$className} implements ${iface}`);
      return interfaceDecoder;
    }
  }

  decoderCache.set(value.$className, null);
  return null;
}

// Resolves the decoder of a value of a declared reference type, and why it was chosen (for the log).
function resolveDecoderClass(declaredType: string, value: Java.Wrapper): { decoderClass: DecoderConstructor; reason: string } {
  const runtimeClass: string = value.$className;

  // 1. class decoder for the runtime class exists
  const classDecoder = getClassDecoderRegistry()[runtimeClass];
  if (classDecoder) return { decoderClass: classDecoder, reason: `class decoder for ${runtimeClass}` };

  // 2. interface decoder for the declared type exists (skips the reflective walk of step 3)
  const declaredInterfaceDecoder = getInterfaceDecoderRegistry()[declaredType];
  if (declaredInterfaceDecoder) return { decoderClass: declaredInterfaceDecoder, reason: `interface decoder for ${declaredType}` };

  // 3. resolve the interfaces and use a decoder if implemented
  const interfaceDecoder = resolveInterfaceDecoderClass(value);
  if (interfaceDecoder) {
    const registry = getInterfaceDecoderRegistry();
    const iface = Object.keys(registry).find((name) => registry[name] === interfaceDecoder);
    return { decoderClass: interfaceDecoder, reason: `interface decoder for ${iface ?? "an implemented interface"}` };
  }

  // 4. toString(). Not GetterDecoder: the getters of e.g. Class/Method/Field reference each other endlessly.
  return { decoderClass: StringDecoder, reason: "toString(), no decoder registered" };
}

export class ReferenceTypeDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "ReferenceTypeDecoder";
  readonly description = "Picks the decoder for an object by its runtime class: a registered class or interface decoder, otherwise its `toString()`.";

  decode(value: Java.Wrapper): DecodedValue {
    if (value == null) {
      return {
        type: this.type,
        name: this.name,
        value: null,
      };
    }

    const runtimeClass: string = value.$className;
    const cacheKey = `${this.type}|${runtimeClass}`;
    let decoderClass = resolvedDecoderCache.get(cacheKey);
    let reason: string | undefined;
    if (decoderClass) {
      logger.debug(`Decoder cache hit: ${this.type} (runtime class ${runtimeClass})`);
    } else {
      logger.debug(`Decoder cache miss: ${this.type} (runtime class ${runtimeClass})`);
      ({ decoderClass, reason } = resolveDecoderClass(this.type, value));
      resolvedDecoderCache.set(cacheKey, decoderClass);
    }

    const decoder = new decoderClass({
      type: runtimeClass,
      name: this.name,
      settings: this.settings,
    });

    // logged at info level once per declared type and runtime class (on a cache miss)
    if (reason) {
      const types = runtimeClass === this.type ? this.type : `${this.type} (runtime class ${runtimeClass})`;
      logger.info(`Decoder for ${types}: ${decoder.decoderName} (${reason})`);
    }

    return {
      type: this.type,
      name: this.name,
      value: decoder.decode(value),
    };
  }
}
