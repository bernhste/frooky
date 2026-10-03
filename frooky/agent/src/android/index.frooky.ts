import Java from "frida-java-bridge";
import { FrookyAgent } from "../FrookyAgent";
import { DEFAULT_SETTING_LOG_LEVEL, DEFAULT_SETTING_LOG_TO } from "../shared/defaultValues";
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

// RPC calls run on Frida's JS thread. In spawn mode the host resumes the app once loadFrookyConfigs() has replied, so
// framework classes and `early: true` native hooks are installed before app code runs. App classes and the other
// native hooks wait for FrookyAgent.targetReady.
rpc.exports = {
  initFrookyAgent(logLevel?: LogLevel, logTo?: LogTo) {
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
      // objects, unlike event batches (arrays)
      (progress) => send({ frooky: "progress", ...progress }),
      new Promise((resolve) => Java.perform(() => resolve())),
    );
    frookyAgent.reportCrashes((crash) => send({ frooky: "crash", ...crash }));
  },
  // configIds (index-aligned hook file paths) identify the configs for updateFrookyConfig()
  // Frida replies once the returned promise resolves: in spawn mode, the host resumes the app then
  loadFrookyConfigs(frookyConfigs: InputFrookyConfig[], configIds?: string[]) {
    return initializedFrookyAgent()
      .loadFrookyConfigs(frookyConfigs, configIds)
      .catch((e) => console.error(`Error loading frooky configs: ${String(e)}`));
  },
  // every hook declaration with its state and event count, for the host's `i` key
  hookStatistics() {
    return initializedFrookyAgent().hookStatistics();
  },
  // replaces the config loaded under configId, re-hooking only what changed
  updateFrookyConfig(configId: string, frookyConfig: InputFrookyConfig, retryNotFound?: boolean) {
    initializedFrookyAgent()
      .loadFrookyConfig(frookyConfig, configId, retryNotFound ?? false)
      .catch((e) => console.error(`Error updating frooky config: ${String(e)}`));
  },
};
