import ObjC from "frida-objc-bridge";
import { FrookyAgent } from "../../FrookyAgent";
import { PlatformHookManager } from "../../shared/hook/hookManager";
import { logger } from "../../shared/logger";
import { PlatformStackTrace } from "../../shared/platformStackTrace";
import { ObjcHookManager } from "../objc/hook/objcHookManager";
import { IosHook } from "./iosHook";
import { IosInputHookNormalized } from "./iosHookValidator";

/**
 * Hook manager for iOS. It does not resolve or register anything itself, but routes the hooks
 * to the manager of the bridge they were declared for (Objective-C, in the future Swift).
 */
export class IosHookManager implements PlatformHookManager<IosInputHookNormalized, IosHook> {
  private readonly objcHookManager: ObjcHookManager;

  constructor(platformStackTrace: PlatformStackTrace, frookyAgent: FrookyAgent) {
    if (!ObjC.available) {
      throw new Error("[!] The Objective-C runtime is not available. Make sure to run this version of the frooky agent on iOS.");
    }
    this.objcHookManager = new ObjcHookManager(platformStackTrace, frookyAgent);
  }

  async resolveHooks(inputHooks: IosInputHookNormalized[], timeout: number): Promise<Promise<IosHook[] | null>[]> {
    logger.debug(`Resolving iOS hooks`);
    const objcInputHooks = inputHooks.filter((inputHook) => "objcClass" in inputHook);
    return [...(await this.objcHookManager.resolveHooks(objcInputHooks, timeout))];
  }

  registerHooks(hooks: IosHook[]): number {
    return this.objcHookManager.registerHooks(hooks.filter((hook) => "objcClass" in hook));
  }
}
