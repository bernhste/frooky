import Java from "frida-java-bridge";
import { makeMethodMangler } from "frida-java-bridge/lib/android.js";
import { logger } from "../shared/logger";

// frida-java-bridge's ArtMethodMangler, which every change of a method's `implementation` goes through
type MethodMangler = { methodId: NativePointer; replace(...args: unknown[]): unknown; revert(...args: unknown[]): unknown };

declare module "frida-java-bridge/lib/android.js" {
  export function makeMethodMangler(methodId: NativePointer): MethodMangler;
}

// the replacement of each method, by ArtMethod, and whether frooky installed it
const replacements = new Map<string, { mangler: MethodMangler; byFrooky: boolean }>();
// the replacement the last revert removed, until the next replace. frida-java-bridge reverts the replacement a Method
// wrapper has before it installs a new one, and a -l script can use the same wrapper as frooky.
let lastReverted: { key: string; byFrooky: boolean; revertedByFrooky: boolean } | undefined;
// e.g. `android.app.Activity.onResume`, by ArtMethod
const frookyTargets = new Map<string, string>();
// set while frooky replaces or reverts a method, see asFrooky()
let frookyTarget: string | undefined;
let tracking = false;

// Runs `fn`, which replaces or reverts the implementation of `target`, as frooky
export function asFrooky<T>(target: string, fn: () => T): T {
  frookyTarget = target;
  try {
    return fn();
  } finally {
    frookyTarget = undefined;
  }
}

// a jmethodID to create a mangler with, for its prototype
function anyMethodId(): NativePointer {
  let methodId = NULL;
  Java.vm.perform(() => {
    const env = Java.vm.getEnv();
    const objectClass = env.findClass("java/lang/Object");
    methodId = env.getMethodId(objectClass, "hashCode", "()I");
    env.deleteLocalRef(objectClass);
  });
  return methodId;
}

// Warns when a -l script and frooky hook the same method. Both use the agent's frida-java-bridge, which keeps one
// replacement per method: the later one replaces the earlier one. Tracked on the mangler's prototype, as the
// `implementation` accessor of frida-java-bridge's Method wrappers can't be redefined. Call before the -l scripts run.
export function trackScriptReplacements(): void {
  if (tracking) return;
  tracking = true;
  const prototype: MethodMangler = Object.getPrototypeOf(makeMethodMangler(anyMethodId()));
  const { replace, revert } = prototype;
  prototype.replace = function (this: MethodMangler, ...args: unknown[]) {
    const key = this.methodId.toString();
    const byFrooky = frookyTarget !== undefined;
    if (frookyTarget !== undefined) frookyTargets.set(key, frookyTarget);
    let previousByFrooky = replacements.get(key)?.byFrooky;
    if (previousByFrooky === undefined && lastReverted?.key === key && lastReverted.revertedByFrooky === byFrooky) {
      previousByFrooky = lastReverted.byFrooky;
    }
    lastReverted = undefined;
    if (previousByFrooky !== undefined && previousByFrooky !== byFrooky) {
      const target = frookyTargets.get(key) ?? "a method";
      logger.warn(
        byFrooky
          ? `${target} is also hooked by a -l script: frooky's hook replaces the script's, which no longer runs`
          : `A -l script hooks ${target}, which frooky hooks too: the script's hook replaces frooky's, which records no more events`,
      );
    }
    replacements.set(key, { mangler: this, byFrooky });
    return replace.apply(this, args);
  };
  // a revert removes the method's replacement, whoever installed it, as the bridge keeps one per method
  prototype.revert = function (this: MethodMangler, ...args: unknown[]) {
    const key = this.methodId.toString();
    const current = replacements.get(key);
    replacements.delete(key);
    lastReverted = current?.mangler === this ? { key, byFrooky: current.byFrooky, revertedByFrooky: frookyTarget !== undefined } : undefined;
    return revert.apply(this, args);
  };
}
