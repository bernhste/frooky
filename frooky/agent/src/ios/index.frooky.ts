import ObjC from "frida-objc-bridge";
import { FrookyAgent } from "../FrookyAgent";
import { DEFAULT_SETTING_LOG_LEVEL, DEFAULT_SETTING_LOG_TO, DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS } from "../shared/defaultValues";
import { InputFrookyConfig } from "../shared/frookyConfig";
import { LogLevel, LogTo } from "../shared/logger";
import { IosHookManager } from "./hook/iosHookManager";
import { IosHookValidator } from "./hook/iosHookValidator";
import { IosStackTrace } from "./iosStackTrace";

let frookyAgent: FrookyAgent;

rpc.exports = {
  initFrookyAgent(logLevel?: LogLevel, logTo?: LogTo, resolverTimeoutSeconds?: number) {
    if (!ObjC.available) {
      throw new Error("[!] The agent is not run on an iOS device. Make sure to run this version of the frooky agent on iOS.");
    }
    frookyAgent = new FrookyAgent(
      "iOS",
      new IosHookValidator(),
      (frookyAgent) => new IosHookManager(IosStackTrace, frookyAgent),
      IosStackTrace,
      logLevel ?? DEFAULT_SETTING_LOG_LEVEL,
      logTo ?? DEFAULT_SETTING_LOG_TO,
      resolverTimeoutSeconds ?? DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
    );
  },
  loadFrookyConfigs(frookyConfigs: InputFrookyConfig[]) {
    if (!frookyAgent) {
      throw new Error("[!] frookyAgent is not initialized. Call initFrookyAgent() first.");
    }
    frookyAgent.loadFrookyConfigs(frookyConfigs).catch((e) => console.error(`[!] Error loading frooky configs: ${String(e)}`));
  },
};
