import Java from "frida-java-bridge";
import { Decoder } from "../../shared/decoders/baseDecoder";
import { ClipDataDecoder } from "./android/content/clipData/ClipDataDecoder";
import { ClipDataItemDecoder } from "./android/content/clipData/ClipDataItemDecoder";
import { IntentDecoder } from "./android/content/IntentDecoder";
import { BundleDecoder } from "./android/os/BundleDecoder";
import { KeyGenParameterSpecDecoder } from "./android/security/keystore/KeyGenParameterSpecDecoder";
import { IterableDecoder } from "./java/lang/IterableDecoder";
import { MapDecoder } from "./java/util/MapDecoder";
import { JavaFallbackDecoder } from "./javaBasicDecoder";
import { JavaDecodedValue } from "./javaDecodedValue";
import { DecoderConstructor } from "./javaDecoderResolver";

const CLASS_DECODER_REGISTRY: Record<string, DecoderConstructor> = {
  "android.content.Intent": IntentDecoder,
  "android.content.ClipData": ClipDataDecoder,
  "android.content.ClipData$Item": ClipDataItemDecoder,
  "android.os.Bundle": BundleDecoder,
  "android.security.keystore.KeyGenParameterSpec": KeyGenParameterSpecDecoder,
};

const INTERFACE_DECODER_REGISTRY: Record<string, DecoderConstructor> = {
  "java.util.Map": MapDecoder,
  "java.lang.Iterable": IterableDecoder,
};

const _ifaceCache = new Map<string, string[]>();

const _decoderCache = new Map<string, DecoderConstructor>();

function resolveInterfaces(clazz: Java.Wrapper | null): string[] {
  if (clazz === null) return [];

  const className: string = clazz.getName();
  const cached = _ifaceCache.get(className);
  if (cached !== undefined) return cached;

  const result: string[] = [];

  for (const iface of clazz.getInterfaces() as Java.Wrapper[]) {
    result.push(iface.getName());
    result.push(...resolveInterfaces(iface));
  }

  result.push(...resolveInterfaces(clazz.getSuperclass() as Java.Wrapper | null));

  _ifaceCache.set(className, result);
  return result;
}

function resolveDecoderClass(className: string, clazz: Java.Wrapper): DecoderConstructor {
  const cached = _decoderCache.get(className);
  if (cached !== undefined) return cached;

  const byClass = CLASS_DECODER_REGISTRY[className];
  if (byClass) {
    _decoderCache.set(className, byClass);
    return byClass;
  }

  const interfaces = resolveInterfaces(clazz);
  for (const iface of interfaces) {
    const byIface = INTERFACE_DECODER_REGISTRY[iface];
    if (byIface) {
      _decoderCache.set(className, byIface);
      return byIface;
    }
  }

  _decoderCache.set(className, JavaFallbackDecoder);
  return JavaFallbackDecoder;
}

export class JavaReferenceTypeDecoder extends Decoder<Java.Wrapper> {
  private implementationDecoder: Decoder<Java.Wrapper> | undefined;
  private implementationType: string | undefined;

  decode(value: Java.Wrapper): JavaDecodedValue {
    if (!this.implementationDecoder) {
      frooky.log.debug(`Resolving decoder for declared type: ${this.decodable.type}`);

      this.implementationType = value.$className;

      const decoderClass = resolveDecoderClass(this.implementationType, value);
      this.implementationDecoder = new decoderClass({
        type: this.implementationType,
        name: this.decodable.name,
        settings: this.decodable.settings,
      });
    } else if (value.$className !== this.implementationType) {
      throw new Error(
        `JavaReferenceTypeDecoder: runtime type changed from "${this.implementationType}" to "${value.$className}". Create a new decoder instance per type.`,
      );
    }

    return {
      declaredType: this.decodable.type,
      implementationType: this.implementationType,
      name: this.decodable.name,
      value: this.implementationDecoder.decode(value),
    };
  }
}
