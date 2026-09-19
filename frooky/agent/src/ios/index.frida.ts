import ObjC from "frida-objc-bridge";
import { FrookyAgent } from "../FrookyAgent";
import { DEFAULT_SETTING_LOG_TO, DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS } from "../shared/defaultValues";
import { InputFrookyConfig } from "../shared/frookyConfig";
import { IosHookManager } from "./hook/iosHookManager";
import { IosHookValidator } from "./hook/iosHookValidator";
import { IosStackTrace } from "./iosStackTrace";

if (!ObjC.available) {
  throw new Error("[!] The agent is not run on an iOS device. Make sure to run this version of the frooky agent on iOS.");
}

//%%% REPLACE START
const frookyConfigs: InputFrookyConfig[] = [{}] as InputFrookyConfig[];
//%%% REPLACE STOP

const frookyAgent = new FrookyAgent(
  "iOS",
  new IosHookValidator(),
  (frookyAgent) => new IosHookManager(IosStackTrace, frookyAgent),
  IosStackTrace,
  "debug",
  DEFAULT_SETTING_LOG_TO,
  DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
);
frookyAgent.loadFrookyConfigs(frookyConfigs);
