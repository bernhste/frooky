import ObjC from "frida-objc-bridge";
import { FrookyAgent } from "../FrookyAgent";
import { DEFAULT_SETTING_LOG_TO, DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS } from "../shared/defaultValues";
import { InputFrookyConfig } from "../shared/frookyConfig";
import { ObjcHookManager } from "./hook/objcHookManager";
import { ObjcHookValidator } from "./hook/objcHookValidator";
import { IosStackTrace } from "./iosStackTrace";

var frookyConfigs: InputFrookyConfig[];

if (ObjC.available) {
  //%%% REPLACE START
  frookyConfigs = [{}] as InputFrookyConfig[];
  //%%% REPLACE STOP

  globalThis.frooky = new FrookyAgent(
    "iOS",
    new ObjcHookValidator(),
    new ObjcHookManager(IosStackTrace),
    IosStackTrace,
    "debug",
    DEFAULT_SETTING_LOG_TO,
    DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
  );
  frooky.loadFrookyConfigs(frookyConfigs);
} else {
  console.error("[!] The objective-c environment is not available.");
}
