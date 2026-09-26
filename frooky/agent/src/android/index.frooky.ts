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
    frookyAgentReady.catch((e) => console.error(`Error initializing frookyAgent: ${String(e)}`));
  },
  // configIds (index-aligned, e.g. the hook file paths) let later updateFrookyConfig() calls replace a config
  loadFrookyConfigs(frookyConfigs: InputFrookyConfig[], configIds?: string[]) {
    if (!frookyAgentReady) {
      throw new Error("[!] frookyAgent is not initialized. Call initFrookyAgent() first.");
    }
    frookyAgentReady
      .then(() => frookyAgent.loadFrookyConfigs(frookyConfigs, configIds))
      .catch((e) => console.error(`Error loading frooky configs: ${String(e)}`));
  },
  // replaces the config loaded under configId, re-hooking only what changed; retryFailed also retries hooks that failed to resolve
  updateFrookyConfig(configId: string, frookyConfig: InputFrookyConfig, retryFailed?: boolean) {
    if (!frookyAgentReady) {
      throw new Error("[!] frookyAgent is not initialized. Call initFrookyAgent() first.");
    }
    frookyAgentReady
      .then(() => frookyAgent.loadFrookyConfig(frookyConfig, configId, retryFailed ?? false))
      .catch((e) => console.error(`Error updating frooky config: ${String(e)}`));
  },
};
