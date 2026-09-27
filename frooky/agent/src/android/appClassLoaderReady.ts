import Java from "frida-java-bridge";

/**
 * Resolves once the app's class loader is set, so app classes can be looked up with `Java.use()`.
 *
 * When attached to a running app, that is right away, on Frida's JS thread. In spawn mode, it is when the
 * resumed app binds its application: on the app's main thread, before any app code runs. Whatever waits
 * for it then continues synchronously on the main thread, which delays the app's start, so keep that work
 * short (the logger already defers its output to the JS thread).
 */
export function appClassLoaderReady(): Promise<void> {
  return new Promise((resolve) => Java.perform(() => resolve()));
}
