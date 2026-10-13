import Java from "frida-java-bridge";
import { setTimeoutOnJsThread } from "../shared/jsThread";
import { logger } from "../shared/logger";
import { AndroidHookManager } from "./hook/androidHookManager";

// sem_t of bionic is 16 bytes
const SEM_SIZE = 16;

// Lets app threads wait until another thread opens it. A wait gives up the agent's lock, so other threads run the
// agent's code meanwhile.
class Gate {
  private opened = false;
  private readonly sem = Memory.alloc(SEM_SIZE);
  private readonly semWait: NativeFunction<number, [NativePointer]>;
  private readonly semPost: NativeFunction<number, [NativePointer]>;

  constructor() {
    const libc = Process.getModuleByName("libc.so");
    new NativeFunction(libc.getExportByName("sem_init"), "int", ["pointer", "int", "uint"])(this.sem, 0, 0);
    this.semWait = new NativeFunction(libc.getExportByName("sem_wait"), "int", ["pointer"]);
    this.semPost = new NativeFunction(libc.getExportByName("sem_post"), "int", ["pointer"]);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    this.opened = true;
    this.semPost(this.sem);
  }

  wait(): void {
    if (this.opened) return;
    // sem_wait() also returns when a signal interrupts it
    while (!this.opened) this.semWait(this.sem);
    // for the next thread that waits
    this.semPost(this.sem);
  }
}

// how long the app's main thread waits at most, so an error in the agent can't stop the app's start-up for good
const HOLD_BACK_TIMEOUT_MS = 10000;

// targetReady of an Android app: Java.perform() runs its callback once the app's class loader is known. When
// attaching, that is right away. In a spawned app, it is inside the first ActivityThread.getPackageInfo() call, which
// the app's main thread makes in handleBindApplication() and a binder thread in ActivityClientRecord.<init>(),
// whichever comes first.
export class TargetReady {
  readonly promise: Promise<void>;
  private resolved = false;

  constructor() {
    this.promise = new Promise((resolve) =>
      Java.perform(() => {
        this.resolved = true;
        resolve();
      }),
    );
  }

  // Makes the app's main thread wait before LoadedApk.makeApplication(), which loads the Application class, until
  // `handled` resolves. Otherwise it loads the Application class and its libraries while a binder thread, or the
  // threads that run what waits for targetReady after it, still install the hooks that waited. Call when spawning,
  // before the app is resumed.
  holdBackApp(hookManager: AndroidHookManager, handled: Promise<void>): void {
    if (this.resolved) return;
    const gate = new Gate();
    void handled.then(() => gate.open());
    let timeoutSet = false;
    try {
      const loadedApk = Java.use("android.app.LoadedApk");
      // Android 13 and later: handleBindApplication() calls makeApplicationInner()
      const methodName = "makeApplicationInner" in loadedApk ? "makeApplicationInner" : "makeApplication";
      for (const overload of loadedApk[methodName].overloads) {
        hookManager.holdBack(overload, methodName, () => {
          if (!gate.isOpen && !timeoutSet) {
            timeoutSet = true;
            setTimeoutOnJsThread(() => {
              if (gate.isOpen) return;
              logger.warn(`The hooks that waited for targetReady aren't installed after ${HOLD_BACK_TIMEOUT_MS} ms, the app starts without them`);
              gate.open();
            }, HOLD_BACK_TIMEOUT_MS);
          }
          gate.wait();
        });
      }
    } catch (e) {
      logger.warn(`The app's main thread isn't held back at targetReady, hooks on code that runs right after can miss calls: ${e}`);
    }
  }
}
