import ObjC from "frida-objc-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { logger } from "../../../../shared/logger";
import { NSDataDecoder } from "../foundation/NSDataDecoder";
import { NSDictionaryDecoder } from "../foundation/NSDictionaryDecoder";
import type { ObjcDecoderConstructor } from "../objcDecoderResolver";
import { ObjcStringDecoder } from "./ObjcStringDecoder";

let classDecoderRegistry: Record<string, ObjcDecoderConstructor> | undefined;
function getClassDecoderRegistry(): Record<string, ObjcDecoderConstructor> {
  return (classDecoderRegistry ??= {
    NSData: NSDataDecoder,
    NSDictionary: NSDictionaryDecoder,
  });
}

// runtime class name -> decoder class. Class clusters (e.g. `__NSCFData`) are common, so the lookup walking
// the superclasses is cached.
const decoderClassCache = new Map<string, ObjcDecoderConstructor>();

function resolveClassDecoder(object: ObjC.Object): ObjcDecoderConstructor {
  const className = object.$className;
  const cached = decoderClassCache.get(className);
  if (cached) return cached;

  // the runtime class is usually a private subclass of the class a decoder is registered for
  const registry = getClassDecoderRegistry();
  let decoderConstructor: ObjcDecoderConstructor = ObjcStringDecoder;
  for (let cls: ObjC.Object | null = object.$class; cls; cls = cls.$superClass) {
    const registered = registry[cls.$className];
    if (registered) {
      decoderConstructor = registered;
      break;
    }
  }
  decoderClassCache.set(className, decoderConstructor);
  return decoderConstructor;
}

// The declared type of an object (`id`, `NSString *`, ...) says little, so the decoder is picked by the
// runtime class of each value.
export class ObjcReferenceDecoder extends Decoder<NativePointer> {
  readonly decoderName = "ObjcReferenceDecoder";
  readonly description = "Decodes an object by its runtime class: `NSData` as hex, `NSDictionary` as an object, anything else as its `-description`.";

  // decoder per `$kind:$className`, e.g. `instance:__NSCFData`, with this decoder's settings
  private readonly decoders = new Map<string, Decoder<NativePointer>>();

  decode(value: NativePointer): DecodedValue {
    if (value.isNull()) {
      return { type: this.type, name: this.name, value: null };
    }

    const object = new ObjC.Object(value);
    const className = object.$className;
    const key = `${object.$kind}:${className}`;
    let decoder = this.decoders.get(key);
    if (!decoder) {
      // a class object (`Class`) is decoded as its name
      const decoderConstructor = object.$kind === "class" ? ObjcStringDecoder : resolveClassDecoder(object);
      decoder = new decoderConstructor({ type: className, name: this.name, settings: this.settings });
      this.decoders.set(key, decoder);
      logger.debug(`Objective-C class '${className}' is decoded by ${decoder.decoderName}.`);
    }
    return { type: this.type, name: this.name, value: decoder.decode(value).value };
  }
}
