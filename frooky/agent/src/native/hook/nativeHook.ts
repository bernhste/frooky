import { Param } from "../../shared/decoders/decodable";
import { Hook } from "../../shared/hook/hook";

/**
 * Contains all information to hook a native function.
 *
 * @public
 */
export interface NativeHook extends Hook {
  moduleName: string;
  module: Module;
  symbolName: string;
  symbolAddress: NativePointer;
  params?: Param[];

  /** The Interceptor listener while the hook is installed, used to detach it again. */
  listener?: InvocationListener;
}
