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

// the most bytes the Interceptor overwrites at a hooked address (an absolute jump on x86_64 or arm64)
export const INTERCEPTOR_PATCH_BYTES = 16;
