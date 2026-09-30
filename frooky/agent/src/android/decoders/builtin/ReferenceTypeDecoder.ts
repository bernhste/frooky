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

export type ClassDecoderRegistry = Record<string, DecoderConstructor>;

// Ordered: when a class implements several unrelated interfaces with a decoder, the earlier entry wins.
export type InterfaceDecoderRegistry = [string, DecoderConstructor][];

let classDecoderRegistry: ClassDecoderRegistry | undefined;
function getClassDecoderRegistry(): ClassDecoderRegistry {
  return (classDecoderRegistry ??= {
    "android.content.ClipData": ClipDataDecoder,
    "android.content.ClipData$Item": ClipDataItemDecoder,
    "android.os.Bundle": BundleDecoder,
    "android.security.keystore.KeyGenParameterSpec": KeyGenParameterSpecDecoder,
    "android.content.ContentValues": ContentValuesDecoder,
    "android.content.Intent": IntentDecoder,
  });
}

let interfaceDecoderRegistry: InterfaceDecoderRegistry | undefined;
function getInterfaceDecoderRegistry(): InterfaceDecoderRegistry {
  return (interfaceDecoderRegistry ??= [
    ["java.util.Map", MapDecoder],
    ["java.lang.Iterable", IterableDecoder],
  ]);
}

export interface DecoderResolution {
  decoderClass: DecoderConstructor;
  // why the decoder was chosen, for the log
  reason: string;
  // the other most specific interfaces with a decoder, if the registry order had to decide
  ambiguousWith?: string[];
}

// the decoder per runtime class
const resolvedDecoderCache = new Map<string, DecoderConstructor>();

let javaObject: Java.Wrapper | undefined;
function getJavaObject(): Java.Wrapper {
  return (javaObject ??= Java.use("java.lang.Object"));
}

// java.lang.Class of each interface name, looked up once
const interfaceClassCache = new Map<string, Java.Wrapper | null>();
function getInterfaceClass(name: string): Java.Wrapper | null {
  let javaClass = interfaceClassCache.get(name);
  if (javaClass === undefined) {
    try {
      javaClass = Java.use(name).class as Java.Wrapper;
    } catch (e) {
      logger.warn(`Interface ${name} of the decoder registry is not available: ${e}`);
      javaClass = null;
    }
    interfaceClassCache.set(name, javaClass);
  }
  return javaClass;
}

// The class decoder of the runtime class or of its nearest superclass with one.
function resolveClassDecoder(runtimeClass: Java.Wrapper, registry: ClassDecoderRegistry): DecoderResolution | null {
  const runtimeClassName: string = runtimeClass.getName();
  for (let javaClass: Java.Wrapper | null = runtimeClass; javaClass !== null; javaClass = javaClass.getSuperclass()) {
    const className: string = javaClass.getName();
    const decoderClass = registry[className];
    if (decoderClass) {
      const reason = className === runtimeClassName ? `class decoder for ${className}` : `class decoder for superclass ${className}`;
      return { decoderClass, reason };
    }
  }
  return null;
}

// The decoder of the most specific interface the runtime class implements: an interface that extends another one
// wins, e.g. java.util.Collection over java.lang.Iterable. Among unrelated interfaces, the registry order decides.
function resolveInterfaceDecoder(runtimeClass: Java.Wrapper, registry: InterfaceDecoderRegistry): DecoderResolution | null {
  const implemented = registry
    .map(([name, decoderClass]) => ({ name, decoderClass, javaClass: getInterfaceClass(name) }))
    .filter(({ javaClass }) => javaClass !== null && javaClass.isAssignableFrom(runtimeClass));

  const mostSpecific = implemented.filter(
    (candidate) => !implemented.some((other) => other !== candidate && candidate.javaClass!.isAssignableFrom(other.javaClass)),
  );
  if (mostSpecific.length === 0) return null;

  const [chosen, ...others] = mostSpecific;
  return {
    decoderClass: chosen.decoderClass,
    reason: `interface decoder for ${chosen.name}`,
    ambiguousWith: others.length > 0 ? others.map(({ name }) => name) : undefined,
  };
}

// Resolves the decoder of a runtime class: a class decoder of the class or a superclass, else the decoder of the most
// specific implemented interface, else toString(). The registries are parameters for tests.
export function resolveDecoderClass(
  runtimeClass: Java.Wrapper,
  classRegistry: ClassDecoderRegistry = getClassDecoderRegistry(),
  interfaceRegistry: InterfaceDecoderRegistry = getInterfaceDecoderRegistry(),
): DecoderResolution {
  return (
    resolveClassDecoder(runtimeClass, classRegistry) ??
    resolveInterfaceDecoder(runtimeClass, interfaceRegistry) ??
      // Not GetterDecoder: the getters of e.g. Class/Method/Field reference each other endlessly.
      { decoderClass: StringDecoder, reason: "toString(), no decoder registered" }
  );
}

export class ReferenceTypeDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "ReferenceTypeDecoder";
  readonly description =
    "Picks the decoder for an object by its runtime class: a class decoder of the class or a superclass, the decoder of its most specific interface, otherwise its `toString()`.";

  decode(value: Java.Wrapper): DecodedValue {
    if (value == null) {
      return {
        type: this.type,
        name: this.name,
        value: null,
      };
    }

    const runtimeClass: string = value.$className;
    let decoderClass = resolvedDecoderCache.get(runtimeClass);
    let resolution: DecoderResolution | undefined;
    if (decoderClass) {
      logger.debug(`Decoder cache hit: ${runtimeClass}`);
    } else {
      logger.debug(`Decoder cache miss: ${runtimeClass}`);
      // getClass() is the runtime class, `.class` would be the wrapper's static type (e.g. java.lang.Object for
      // an element of an Object[]). The cast is needed because a wrapper typed as an interface has no getClass().
      resolution = resolveDecoderClass(Java.cast(value, getJavaObject()).getClass());
      decoderClass = resolution.decoderClass;
      resolvedDecoderCache.set(runtimeClass, decoderClass);
    }

    const decoder = new decoderClass({
      type: runtimeClass,
      name: this.name,
      settings: this.settings,
    });

    // logged once per runtime class (on a cache miss)
    if (resolution) {
      const types = runtimeClass === this.type ? this.type : `${this.type} (runtime class ${runtimeClass})`;
      logger.info(`Decoder for ${types}: ${decoder.decoderName} (${resolution.reason})`);
      if (resolution.ambiguousWith) {
        logger.warn(
          `${runtimeClass} also implements ${resolution.ambiguousWith.join(", ")}, using ${decoder.decoderName}. Set \`decoder:\` to choose another decoder.`,
        );
      }
    }

    return {
      type: this.type,
      name: this.name,
      value: decoder.decode(value),
    };
  }
}
