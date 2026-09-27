import Java from "frida-java-bridge";
import { FrookyAgent } from "../FrookyAgent";
import { DEFAULT_SETTING_LOG_LEVEL, DEFAULT_SETTING_LOG_TO, DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS } from "../shared/defaultValues";
import { InputFrookyConfig } from "../shared/frookyConfig";
import { LogLevel, LogTo } from "../shared/logger";
import { AndroidStackTrace } from "./androidStackTrace";
import { AndroidHookManager } from "./hook/androidHookManager";
import { AndroidHookValidator } from "./hook/androidHookValidator";

let frookyAgent: FrookyAgent | undefined;

function initializedFrookyAgent(): FrookyAgent {
  if (!frookyAgent) {
    throw new Error("[!] frookyAgent is not initialized. Call initFrookyAgent() first.");
  }
  return frookyAgent;
}

// RPC calls run on Frida's JS thread. In spawn mode the host resumes the app only after loadFrookyConfigs(),
// so native hooks and hooks on framework classes are installed before any app code runs. Lookups of app
// classes wait for Java.perform(), i.e. the app's class loader, see FrookyAgent.targetReady.
rpc.exports = {
  initFrookyAgent(logLevel?: LogLevel, logTo?: LogTo, resolverTimeoutSeconds?: number) {
    if (!Java.available) {
      throw new Error("[!] The agent is not run on an Android device. Make sure to run this version of the frooky agent on Android.");
    }
    if (frookyAgent) {
      throw new Error("[!] frookyAgent is already initialized.");
    }
    frookyAgent = new FrookyAgent(
      "Android",
      new AndroidHookValidator(),
      (frookyAgent) => new AndroidHookManager(AndroidStackTrace, frookyAgent),
      AndroidStackTrace,
      logLevel ?? DEFAULT_SETTING_LOG_LEVEL,
      logTo ?? DEFAULT_SETTING_LOG_TO,
      resolverTimeoutSeconds ?? DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
      // an object payload, which the host tells apart from the event batches (arrays)
      (progress) => send({ frooky: "progress", ...progress }),
      new Promise((resolve) => Java.perform(() => resolve())),
    );
    // an object payload like the progress report; the host shows it when the process terminates
    frookyAgent.reportCrashes((crash) => send({ frooky: "crash", ...crash }));
  },
  // configIds (index-aligned, e.g. the hook file paths) let later updateFrookyConfig() calls replace a config
  loadFrookyConfigs(frookyConfigs: InputFrookyConfig[], configIds?: string[]) {
    initializedFrookyAgent()
      .loadFrookyConfigs(frookyConfigs, configIds)
      .catch((e) => console.error(`Error loading frooky configs: ${String(e)}`));
  },
  // replaces the config loaded under configId, re-hooking only what changed; retryFailed also retries hooks that failed to resolve
  updateFrookyConfig(configId: string, frookyConfig: InputFrookyConfig, retryFailed?: boolean) {
    initializedFrookyAgent()
      .loadFrookyConfig(frookyConfig, configId, retryFailed ?? false)
      .catch((e) => console.error(`Error updating frooky config: ${String(e)}`));
  },
};
