import { Param, RetType } from "../../../shared/decoders/decodable";
import { Hook } from "../../../shared/hook/hook";

/**
 * Contains all information to hook an Objective-C method
 *
 * @public
 */
export interface ObjcHook extends Hook {
  /** The class the method was resolved on. */
  objcClass: string;

  /** The selector without `+`/`-` prefix, e.g. `initWithString:`. */
  selector: string;

  methodType: "instance" | "class";

  /** Address of the method's implementation (IMP). */
  implementation: NativePointer;

  /** Explicit arguments only. The implicit `self` (args[0]) and `_cmd` (args[1]) are not decoded. */
  params: Param[];

  /** Not set if the method returns `void`. */
  retType?: RetType;
}
