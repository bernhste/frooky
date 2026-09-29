import { ObjcHook } from "../objc/hook/objcHook";
import { SwiftHook } from "../swift/hook/swiftHook";

// A resolved iOS hook, told apart by `objcClass` or `swiftType`
export type IosHook = ObjcHook | SwiftHook;
