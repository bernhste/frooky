import Java from "frida-java-bridge";
import { Param } from "../../shared/decoders/decodable";
import { DecoderSettings } from "../../shared/frookySettings";
import { Hook } from "../../shared/hook/hook";

// A resolved Java method overload to hook
export interface JavaHook extends Hook {
  method: Java.Method;
  methodName: string;
  // Set for an instance method the hooked class inherits, e.g. `put` of a class that extends `java.util.HashMap`:
  // the class of the hook file, while `method` is the one of the superclass that declares it. Only the calls on
  // instances of this class are recorded.
  inheritedBy?: Java.Wrapper;
  params?: Param[];

  // decoder settings of the return value, from `returns`, else Hook.decoderSettings. The return type itself
  // comes from reflection.
  retTypeSettings?: DecoderSettings;
}

// The class the hook file names for `hook`, e.g. `com.example.Headers` for its inherited `put`, else the class that
// declares the method
export function hookedClassName(hook: JavaHook): string {
  return String((hook.inheritedBy ?? hook.method.holder).$className);
}
