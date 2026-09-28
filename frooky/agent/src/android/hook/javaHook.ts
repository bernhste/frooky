import Java from "frida-java-bridge";
import { Param } from "../../shared/decoders/decodable";
import { DecoderSettings } from "../../shared/frookySettings";
import { Hook } from "../../shared/hook/hook";

// A resolved Java method overload to hook
export interface JavaHook extends Hook {
  method: Java.Method;
  methodName: string;
  params?: Param[];

  // decoder settings of the return value, from `retType`, else Hook.decoderSettings. The return type itself
  // comes from reflection.
  retTypeSettings?: DecoderSettings;
}
