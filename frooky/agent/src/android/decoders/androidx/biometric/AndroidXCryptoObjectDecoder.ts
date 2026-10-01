import type Java from "frida-java-bridge";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { RecursiveDecoder } from "../../../../shared/decoders/recursiveDecoder";
import { DecoderSettings } from "../../../../shared/frookySettings";
import { decodeGetterValues } from "../../utils/decodeGetterValues";

// The AndroidX Biometric library is part of the app, so its CryptoObject is an app class: the getters are those
// of the runtime class, loaded through the class loader of the value. An app minified with R8 renames the class,
// so the decoder isn't found by name then; `decoder: getters` still works.
export class AndroidXCryptoObjectDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "AndroidXCryptoObjectDecoder";
  readonly description = "Decodes an `androidx.biometric.BiometricPrompt.CryptoObject`: the Cipher, Signature or Mac it wraps.";

  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: decodeGetterValues(value, childSettings),
    };
  }
}
