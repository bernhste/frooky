import { ObjcHook } from "../objc/hook/objcHook";

/**
 * A resolved iOS hook. One member per supported bridge, told apart by their bridge specific properties (e.g. `objcClass`).
 * Adding Swift means adding `| SwiftHook` here.
 */
export type IosHook = ObjcHook;
