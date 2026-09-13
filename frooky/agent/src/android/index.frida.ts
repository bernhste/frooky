import Java from "frida-java-bridge";
import { FrookyAgent } from "../FrookyAgent";
import { DEFAULT_SETTING_LOG_TO, DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS } from "../shared/defaultValues";
import { InputFrookyConfig } from "../shared/frookyConfig";
import { AndroidStackTrace } from "./androidStackTrace";
import { AndroidHookManager } from "./hook/androidHookManager";
import { AndroidHookValidator } from "./hook/androidHookValidator";

if (!Java.available) {
  throw new Error("[!] The agent is not run on an Android device. Make sure to run this version of the frooky agent on Android.");
}

//%%% REPLACE START
const frookyConfigs: InputFrookyConfig[] = [{}] as InputFrookyConfig[];
//%%% REPLACE STOP

Java.perform(() => {
  const frookyAgent = new FrookyAgent(
    "Android",
    new AndroidHookValidator(),
    (frookyAgent) => new AndroidHookManager(AndroidStackTrace, frookyAgent),
    AndroidStackTrace,
    "debug",
    DEFAULT_SETTING_LOG_TO,
    DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
  );
  frookyAgent.loadFrookyConfigs(frookyConfigs);
});
