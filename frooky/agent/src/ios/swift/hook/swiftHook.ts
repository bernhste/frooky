import { Param, RetType } from "../../../shared/decoders/decodable";
import { Hook } from "../../../shared/hook/hook";

// A resolved Swift method to hook
export interface SwiftHook extends Hook {
  // the class, struct or enum that implements the method, qualified with its module, e.g. `MyApp.LoginViewModel`
  swiftType: string;
  swiftKind: "class" | "struct" | "enum";
  // base name of the method, e.g. `authenticate`
  methodName: string;
  // the demangled symbol, which identifies the overload
  methodSymbol: string;
  address: NativePointer;
  // the explicit arguments, without `self`
  params: Param[];
  // not set if the method returns `void`
  retType?: RetType;

  // set while the hook is installed
  listener?: InvocationListener;
}
