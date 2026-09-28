import { Param } from "../../shared/decoders/decodable";
import { Hook } from "../../shared/hook/hook";

// A resolved native function to hook
export interface NativeHook extends Hook {
  moduleName: string;
  module: Module;
  // for hooks declared with `symbol`
  symbolName?: string;
  // for hooks declared with `offset`, e.g. `0x1a2b4`
  offset?: string;
  symbolAddress: NativePointer;
  params?: Param[];

  // set while the hook is installed
  listener?: InvocationListener;
}
