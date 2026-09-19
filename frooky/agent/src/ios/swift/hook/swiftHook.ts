import { Param, RetType } from "../../../shared/decoders/decodable";
import { Hook } from "../../../shared/hook/hook";

/**
 * Contains all information to hook a Swift method
 *
 * @public
 */
export interface SwiftHook extends Hook {
  /** The class, struct or enum the method was resolved on, qualified with its module, e.g. `MyApp.LoginViewModel`. */
  swiftType: string;

  swiftKind: "class" | "struct" | "enum";

  /** The base name of the method, e.g. `authenticate`. */
  methodName: string;

  /** The demangled symbol, which identifies the exact overload. */
  methodSymbol: string;

  /** Address of the method's implementation. */
  address: NativePointer;

  /** Explicit arguments only. The implicit `self` is not decoded. */
  params: Param[];

  /** Not set if the method returns `void`. */
  retType?: RetType;
}
