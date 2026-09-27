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
  /** Exported symbol of the function, for hooks declared with `symbol`. */
  symbolName?: string;
  /** Offset of the function from the module's base address (e.g. `0x1a2b4`), for hooks declared with `offset`. */
  offset?: string;
  /** Runtime address of the function. */
  symbolAddress: NativePointer;
  params?: Param[];

  /** The Interceptor listener while the hook is installed, used to detach it again. */
  listener?: InvocationListener;
}
