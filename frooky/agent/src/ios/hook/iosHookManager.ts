import ObjC from "frida-objc-bridge";
import Swift from "frida-swift-bridge";
import { FrookyAgent } from "../../FrookyAgent";
import { PlatformHookManager } from "../../shared/hook/hookManager";
import { InputObjcHookNormalized } from "../../shared/inputParsing/inputObjcHookCollection";
import { InputSwiftHookNormalized, isSwiftHookNormalized } from "../../shared/inputParsing/inputSwiftHookCollection";
import { logger } from "../../shared/logger";
import { PlatformStackTrace } from "../../shared/platformStackTrace";
import { plural } from "../../shared/utils";
import { ObjcHook } from "../objc/hook/objcHook";
import { ObjcHookManager } from "../objc/hook/objcHookManager";
import { SwiftHook } from "../swift/hook/swiftHook";
import { SwiftHookManager } from "../swift/hook/swiftHookManager";
import { IosHook } from "./iosHook";
import { IosInputHookNormalized } from "./iosHookValidator";

function isObjcHook(hook: IosHook): hook is ObjcHook {
  return "objcClass" in hook;
}

// Passes each hook to the manager of its bridge (Objective-C, Swift).
export class IosHookManager implements PlatformHookManager<IosInputHookNormalized, IosHook> {
  private readonly objcHookManager: ObjcHookManager;
  // only set if the process uses Swift
  private readonly swiftHookManager?: SwiftHookManager;

  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    if (!ObjC.available) {
      throw new Error("[!] The Objective-C runtime is not available. Make sure to run this version of the frooky agent on iOS.");
    }
    this.objcHookManager = new ObjcHookManager(platformStackTrace, frookyAgent);

    if (Swift.available) {
      this.swiftHookManager = new SwiftHookManager(platformStackTrace, frookyAgent);
    } else {
      logger.warn("The Swift runtime is not available in this process. Swift hooks will be skipped.");
    }
  }

  // The returned promises are index-aligned with `inputHooks`, as FrookyAgent expects.
  async resolveHooks(inputHooks: IosInputHookNormalized[], timeout: number, source?: string): Promise<Promise<IosHook[] | null>[]> {
    const objcIndices: number[] = [];
    const swiftIndices: number[] = [];
    inputHooks.forEach((inputHook, i) => (isSwiftHookNormalized(inputHook) ? swiftIndices : objcIndices).push(i));

    const results: Promise<IosHook[] | null>[] = new Array(inputHooks.length);
    if (objcIndices.length > 0) {
      const objcInputHooks = objcIndices.map((i) => inputHooks[i] as InputObjcHookNormalized);
      const objcResults = await this.objcHookManager.resolveHooks(objcInputHooks, timeout, source);
      objcIndices.forEach((inputIndex, i) => (results[inputIndex] = objcResults[i]));
    }
    if (swiftIndices.length > 0) {
      if (this.swiftHookManager) {
        const swiftInputHooks = swiftIndices.map((i) => inputHooks[i] as InputSwiftHookNormalized);
        const swiftResults = await this.swiftHookManager.resolveHooks(swiftInputHooks, timeout, source);
        swiftIndices.forEach((inputIndex, i) => (results[inputIndex] = swiftResults[i]));
      } else {
        logger.warn(`Skipping ${plural(swiftIndices.length, "Swift hook")}, as the Swift runtime is not available.`);
        swiftIndices.forEach((inputIndex) => (results[inputIndex] = Promise.resolve(null)));
      }
    }
    return results;
  }

  registerHooks(hooks: IosHook[], source?: string): number {
    const objcHooks = hooks.filter(isObjcHook);
    const swiftHooks = hooks.filter((hook): hook is SwiftHook => !isObjcHook(hook));
    return (
      (objcHooks.length > 0 ? this.objcHookManager.registerHooks(objcHooks, source) : 0) +
      (swiftHooks.length > 0 && this.swiftHookManager ? this.swiftHookManager.registerHooks(swiftHooks, source) : 0)
    );
  }

  unregisterHooks(hooks: IosHook[]): void {
    this.objcHookManager.unregisterHooks(hooks.filter(isObjcHook));
    this.swiftHookManager?.unregisterHooks(hooks.filter((hook): hook is SwiftHook => !isObjcHook(hook)));
  }
}
