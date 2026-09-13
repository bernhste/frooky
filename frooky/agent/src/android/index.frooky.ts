import Java from "frida-java-bridge";
import { FrookyAgent } from "../FrookyAgent";
import { DEFAULT_SETTING_LOG_LEVEL, DEFAULT_SETTING_LOG_TO, DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS } from "../shared/defaultValues";
import { InputFrookyConfig } from "../shared/frookyConfig";
import { LogLevel, LogTo } from "../shared/logger";
import { AndroidStackTrace } from "./androidStackTrace";
import { AndroidHookManager } from "./hook/androidHookManager";
import { AndroidHookValidator } from "./hook/androidHookValidator";

let frookyAgent: FrookyAgent;

// rpc.exports must be assigned synchronously during script load so the host
// can find these methods immediately. Java.perform() attaches the current
// thread asynchronously if the JVM isn't ready yet, so it must stay inside
// the individual exports rather than wrapping the whole assignment.
rpc.exports = {
  initFrookyAgent(logLevel?: LogLevel, logTo?: LogTo, resolverTimeoutSeconds?: number) {
    if (!Java.available) {
      throw new Error("[!] The agent is not run on an Android device. Make sure to run this version of the frooky agent on Android.");
    }
    // Returning a promise makes the host's RPC call await agent creation,
    // so a subsequent loadFrookyConfigs() call only runs once it's ready.
    return new Promise<void>((resolve, reject) => {
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
  },
  loadFrookyConfigs(frookyConfigs: InputFrookyConfig[]) {
    if (!frookyAgent) {
      throw new Error("[!] frookyAgent is not initialized. Call initFrookyAgent() first.");
    }
    return new Promise<void>((resolve, reject) => {
      Java.perform(() => {
        frookyAgent.loadFrookyConfigs(frookyConfigs).then(resolve, reject);
      });
    });
  },
};
