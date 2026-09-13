import Java from "frida-java-bridge";
import { FrookyAgent } from "../FrookyAgent";
import { DEFAULT_SETTING_LOG_LEVEL, DEFAULT_SETTING_LOG_TO, DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS } from "../shared/defaultValues";
import { InputFrookyConfig } from "../shared/frookyConfig";
import { LogLevel, LogTo } from "../shared/logger";
import { AndroidStackTrace } from "./androidStackTrace";
import { AndroidHookManager } from "./hook/androidHookManager";
import { AndroidHookValidator } from "./hook/androidHookValidator";

let frookyAgent: FrookyAgent;
let frookyAgentReady: Promise<void> | undefined;

rpc.exports = {
  initFrookyAgent(logLevel?: LogLevel, logTo?: LogTo, resolverTimeoutSeconds?: number) {
    if (!Java.available) {
      throw new Error("[!] The agent is not run on an Android device. Make sure to run this version of the frooky agent on Android.");
    }
    frookyAgentReady = new Promise<void>((resolve, reject) => {
      Java.perform(() => {
        try {
          frookyAgent = new FrookyAgent(
            "Android",
            new AndroidHookValidator(),
            (frookyAgent) => new AndroidHookManager(AndroidStackTrace, frookyAgent),
            AndroidStackTrace,
            logLevel ?? DEFAULT_SETTING_LOG_LEVEL,
            logTo ?? DEFAULT_SETTING_LOG_TO,
            resolverTimeoutSeconds ?? DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
          );
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
    frookyAgentReady.catch((e) => console.error(`[!] Error initializing frookyAgent: ${String(e)}`));
  },
  loadFrookyConfigs(frookyConfigs: InputFrookyConfig[]) {
    if (!frookyAgentReady) {
      throw new Error("[!] frookyAgent is not initialized. Call initFrookyAgent() first.");
    }
    frookyAgentReady
      .then(() => frookyAgent.loadFrookyConfigs(frookyConfigs))
      .catch((e) => console.error(`[!] Error loading frooky configs: ${String(e)}`));
  },
};
