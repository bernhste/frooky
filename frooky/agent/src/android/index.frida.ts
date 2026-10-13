import Java from "frida-java-bridge";
import { FrookyAgent } from "../FrookyAgent";
import { DEFAULT_SETTING_LOG_TO } from "../shared/defaultValues";
import { InputFrookyConfig } from "../shared/frookyConfig";
import { AndroidStackTrace } from "./androidStackTrace";
import { AndroidHookManager } from "./hook/androidHookManager";
import { AndroidHookValidator } from "./hook/androidHookValidator";
import { fixArtMethodAccessFlagsOffset } from "./javaBridgeWorkarounds";
import { TargetReady } from "./targetReady";

if (!Java.available) {
  throw new Error("[!] The agent is not run on an Android device. Make sure to run this version of the frooky agent on Android.");
}
// before the first Java.perform(), which can hook a method already
fixArtMethodAccessFlagsOffset();

//%%% REPLACE START
const frookyConfigs: InputFrookyConfig[] = [{}] as InputFrookyConfig[];
//%%% REPLACE STOP

const targetReady = new TargetReady();
const frookyAgent = new FrookyAgent(
  "Android",
  new AndroidHookValidator(),
  (frookyAgent) => {
    const hookManager = new AndroidHookManager(AndroidStackTrace, frookyAgent);
    targetReady.holdBackApp(hookManager, frookyAgent.whenTargetReadyHandled());
    return hookManager;
  },
  AndroidStackTrace,
  "debug",
  DEFAULT_SETTING_LOG_TO,
  undefined,
  targetReady.promise,
);
frookyAgent.loadFrookyConfigs(frookyConfigs);
