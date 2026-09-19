import ObjC from "frida-objc-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { logger } from "../../../../shared/logger";
import { NSDataDecoder } from "../foundation/NSDataDecoder";
import type { ObjcDecoderConstructor } from "../objcDecoderResolver";
import { ObjcStringDecoder } from "./ObjcStringDecoder";

let classDecoderRegistry: Record<string, ObjcDecoderConstructor> | undefined;
function getClassDecoderRegistry(): Record<string, ObjcDecoderConstructor> {
  return (classDecoderRegistry ??= {
    NSData: NSDataDecoder,
  });
}

// runtime class name -> decoder. Class clusters (e.g. `__NSCFData`) are common, so cache the (super class walking) lookup
const decoderCache = new Map<string, ObjcDecoderConstructor>();

function resolveClassDecoder(object: ObjC.Object): ObjcDecoderConstructor {
  const className = object.$className;
  const cached = decoderCache.get(className);
  if (cached) return cached;

  // the runtime class is usually a private subclass of the class a decoder is registered for, so walk up the hierarchy
  const registry = getClassDecoderRegistry();
  let decoderConstructor: ObjcDecoderConstructor = ObjcStringDecoder;
  for (let cls: ObjC.Object | null = object.$class; cls; cls = cls.$superClass) {
    const registered = registry[cls.$className];
    if (registered) {
      decoderConstructor = registered;
      break;
    }
  }
  decoderCache.set(className, decoderConstructor);
  return decoderConstructor;
}

/**
 * Decodes values of type `id` (or a declared class such as `NSString *`).
 * The declared type says little, so the decoder is picked by the runtime class of the object the first time it is decoded.
 */
export class ObjcReferenceDecoder extends Decoder<NativePointer> {
  decode(value: NativePointer): DecodedValue {
    if (value.isNull()) {
      return { type: this.type, name: this.name, value: null };
    }

    const object = new ObjC.Object(value);
    // a class object (`Class`) is decoded as its name
    const decoderConstructor = object.$kind === "class" ? ObjcStringDecoder : resolveClassDecoder(object);
    logger.debug(`Resolved decoder for Objective-C object of class '${object.$className}'.`);

    const decoder = new decoderConstructor({ type: object.$className, name: this.name, settings: this.settings });
    return { type: this.type, name: this.name, value: decoder.decode(value).value };
  }
}
