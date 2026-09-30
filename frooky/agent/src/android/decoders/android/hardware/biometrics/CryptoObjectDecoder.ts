import type Java from "frida-java-bridge";
import { DecodedValue } from "../../../../../shared/decoders/decodedValue";
import { RecursiveDecoder } from "../../../../../shared/decoders/recursiveDecoder";
import { DecoderSettings } from "../../../../../shared/frookySettings";
import { decodeGetterValues } from "../../../utils/decodeGetterValues";

// Shows which Cipher, Signature or Mac a biometric prompt unlocks, decoded by their own decoders.
export class CryptoObjectDecoder extends RecursiveDecoder<Java.Wrapper> {
  readonly decoderName = "CryptoObjectDecoder";
  readonly description = "Decodes a `BiometricPrompt.CryptoObject`: the Cipher, Signature or Mac it wraps.";

  protected decodeRecursive(value: Java.Wrapper, childSettings: DecoderSettings): DecodedValue {
    return {
      type: this.type,
      name: this.name,
      value: decodeGetterValues(value, childSettings, { className: "android.hardware.biometrics.BiometricPrompt$CryptoObject" }),
    };
  }
}
