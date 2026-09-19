import { ObjcHook } from "../objc/hook/objcHook";
import { SwiftHook } from "../swift/hook/swiftHook";

/**
 * A resolved iOS hook. One member per supported bridge, told apart by their bridge specific properties (`objcClass`, `swiftType`).
 */
export type IosHook = ObjcHook | SwiftHook;
