import { logger } from "../shared/logger";
import { INTERCEPTOR_PATCH_BYTES } from "./hook/nativeHook";

// how long hooks installed while a module loads may wait to be committed, see waitUntilCommitted()
const COMMIT_TIMEOUT_MS = 1000;

// A function hooked for the first time while its module loads, with its code before the hook
type PendingCommit = { address: NativePointer; code: ArrayBuffer };

function sameBytes(a: ArrayBuffer | null, b: ArrayBuffer): boolean {
  if (a === null || a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  return x.every((byte, i) => byte === y[i]);
}

// Calls back while the linker loads a module, before its constructors and JNI_OnLoad run, and makes sure the
// hooks installed in that callback are in place before the linker goes on.
export class NativeModuleWatcher {
  // called with a module once it loads, keyed by the name (or path) hooks declare it with
  private readonly moduleWaiters = new Map<string, ((module: Module) => void)[]>();
  // called with every module that loads and matches, until stopped, see whenEachLoaded()
  private readonly matchWatchers = new Set<{ matches: (module: Module) => boolean; onLoaded: (module: Module) => void }>();
  private moduleObserver?: ModuleObserver;
  // the functions hooked by the module observer's current callback, see waitUntilCommitted()
  private pendingCommits: PendingCommit[] | null = null;
  // cooperative, so a call gives up the JS lock. Resolved before the observer is attached: resolving it inside the
  // linker would call dlsym() there.
  private usleep?: NativeFunction<number, [number]>;

  // Calls `onLoaded` with the module while the linker loads it, and resolves with its result
  whenLoaded<T>(moduleName: string, onLoaded: (module: Module) => T): Promise<T> {
    logger.debug(`Waiting for native module ${moduleName} to load.`);
    return new Promise((resolve, reject) => {
      const waiter = (module: Module) => {
        logger.debug(`Module '${moduleName}' loaded.`);
        try {
          resolve(onLoaded(module));
        } catch (e) {
          reject(e);
        }
      };
      this.moduleWaiters.set(moduleName, [...(this.moduleWaiters.get(moduleName) ?? []), waiter]);
      this.observeModules();
    });
  }

  // Calls `onLoaded` with each module that `matches` while the linker loads it, until the returned function is called.
  // Attaching the observer the first time also calls it with the matching modules that are loaded already.
  whenEachLoaded(matches: (module: Module) => boolean, onLoaded: (module: Module) => void): () => void {
    const watcher = { matches, onLoaded };
    this.matchWatchers.add(watcher);
    this.observeModules();
    return () => this.matchWatchers.delete(watcher);
  }

  // Called before the Interceptor first patches `address`. Inside a whenLoaded() callback, the linker then waits
  // until the patch is committed; elsewhere this does nothing.
  beforePatch(address: NativePointer): void {
    if (!this.pendingCommits) return;
    try {
      this.pendingCommits.push({ address, code: address.readByteArray(INTERCEPTOR_PATCH_BYTES)! });
    } catch (_) {}
  }

  // Attached once and kept: attaching calls onAdded() for every loaded module.
  private observeModules(): void {
    this.usleep ??= new NativeFunction(Process.getModuleByName("libc.so").getExportByName("usleep"), "int", ["uint"]);
    this.moduleObserver ??= Process.attachModuleObserver({
      // runs on the thread that loads the module, inside the linker, before its constructors
      onAdded: (module) => {
        const waiters = this.moduleWaiters.get(module.name) ?? this.moduleWaiters.get(module.path) ?? [];
        this.moduleWaiters.delete(module.name);
        this.moduleWaiters.delete(module.path);
        for (const watcher of this.matchWatchers) {
          if (watcher.matches(module)) waiters.push(watcher.onLoaded);
        }
        if (waiters.length === 0) return;
        this.pendingCommits = [];
        try {
          for (const waiter of waiters) waiter(module);
        } finally {
          const pending = this.pendingCommits;
          this.pendingCommits = null;
          this.waitUntilCommitted(pending, module.name);
        }
      },
    });
  }

  // Frida commits Interceptor changes only once no thread is inside a hook callback. If another thread entered one
  // while the hooks were installed here, the commit would come after the module's constructors ran, and their calls
  // would be missed. Giving up the JS lock lets that thread finish, until the hooked functions' code is patched.
  private waitUntilCommitted(pending: PendingCommit[], moduleName: string): void {
    const start = Date.now();
    while (pending.some(({ address, code }) => sameBytes(address.readByteArray(code.byteLength), code))) {
      if (Date.now() - start >= COMMIT_TIMEOUT_MS) {
        logger.warn(`Hooks on ${moduleName} may miss calls while it loads: another thread delayed them by over ${COMMIT_TIMEOUT_MS}ms`);
        return;
      }
      this.usleep!(1000);
    }
  }
}
