import { Param, RetType } from "../../../shared/decoders/decodable";
import { Hook } from "../../../shared/hook/hook";

// A resolved Objective-C method to hook
export interface ObjcHook extends Hook {
  // the class that implements the method
  objcClass: string;
  // without the `+`/`-` prefix, e.g. `initWithString:`
  selector: string;
  methodType: "instance" | "class";
  // address of the method's implementation (IMP)
  implementation: NativePointer;
  // the explicit arguments, without `self` and `_cmd`
  params: Param[];
  // not set if the method returns `void`
  retType?: RetType;

  // set while the hook is installed
  listener?: InvocationListener;
}
