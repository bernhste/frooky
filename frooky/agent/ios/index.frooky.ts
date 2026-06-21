import ObjC from "frida-objc-bridge";
import { FrookyAgent } from "../FrookyAgent";
import { DEFAULT_SETTING_LOG_LEVEL, DEFAULT_SETTING_LOG_TO, DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS } from "../shared/defaultValues";
import { InputFrookyConfig } from "../shared/frookyConfig";
import { LogLevel, LogTo } from "../shared/logger";
import { ObjcHookManager } from "./hook/objcHookManager";
import { ObjcHookValidator } from "./hook/objcHookValidator";

rpc.exports = {
  initFrookyAgent(logLevel?: LogLevel, logTo?: LogTo, resolverTimeoutSeconds?: number) {
    if (ObjC.available) {
      globalThis.frooky = new FrookyAgent(
        "iOS",
        new ObjcHookValidator(),
        new ObjcHookManager(),
        logLevel ?? DEFAULT_SETTING_LOG_LEVEL,
        logTo ?? DEFAULT_SETTING_LOG_TO,
        resolverTimeoutSeconds ?? DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
      );
    } else {
      console.error("[!] The agent is not run on an Android device. Make sure to run this version of the frooky agent on Android.");
    }
  },
  loadFrookyConfigs(frookyConfigs: InputFrookyConfig[]) {
    frooky.loadFrookyConfigs(frookyConfigs);
  },
};
