import ObjC from "frida-objc-bridge";
import Swift from "frida-swift-bridge";
import { FrookyAgent } from "../../FrookyAgent";
import { PlatformHookManager } from "../../shared/hook/hookManager";
import { InputObjcHookNormalized } from "../../shared/inputParsing/inputObjcHookCollection";
import { InputSwiftHookNormalized, isSwiftHookNormalized } from "../../shared/inputParsing/inputSwiftHookCollection";
import { logger } from "../../shared/logger";
import { PlatformStackTrace } from "../../shared/platformStackTrace";
import { ObjcHook } from "../objc/hook/objcHook";
import { ObjcHookManager } from "../objc/hook/objcHookManager";
import { SwiftHook } from "../swift/hook/swiftHook";
import { SwiftHookManager } from "../swift/hook/swiftHookManager";
import { IosHook } from "./iosHook";
import { IosInputHookNormalized } from "./iosHookValidator";

/**
 * Hook manager for iOS. It does not resolve or register anything itself, but routes the hooks
 * to the manager of the bridge they were declared for (Objective-C, Swift).
 */
export class IosHookManager implements PlatformHookManager<IosInputHookNormalized, IosHook> {
  private readonly objcHookManager: ObjcHookManager;
  // only available if the process uses Swift
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

  async resolveHooks(inputHooks: IosInputHookNormalized[], timeout: number): Promise<Promise<IosHook[] | null>[]> {
    logger.debug(`Resolving iOS hooks`);
    const objcInputHooks = inputHooks.filter((inputHook): inputHook is InputObjcHookNormalized => "objcClass" in inputHook);
    const swiftInputHooks = inputHooks.filter((inputHook): inputHook is InputSwiftHookNormalized => isSwiftHookNormalized(inputHook));
    if (swiftInputHooks.length > 0 && !this.swiftHookManager) {
      logger.warn(`Skipping ${swiftInputHooks.length} Swift hook(s), as the Swift runtime is not available.`);
    }
    return [
      ...(await this.objcHookManager.resolveHooks(objcInputHooks, timeout)),
      ...((await this.swiftHookManager?.resolveHooks(swiftInputHooks, timeout)) ?? []),
    ];
  }

  registerHooks(hooks: IosHook[]): number {
    return (
      this.objcHookManager.registerHooks(hooks.filter((hook): hook is ObjcHook => "objcClass" in hook)) +
      (this.swiftHookManager?.registerHooks(hooks.filter((hook): hook is SwiftHook => "swiftType" in hook)) ?? 0)
    );
  }
}
