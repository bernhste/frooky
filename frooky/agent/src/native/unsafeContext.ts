import { UnsafeContext } from "../shared/platformStackTrace";

// Detects calls in which building a stack trace can crash or hang the app. Hooks run on the app's thread and
// stack, so the checks are per call and cheap.

// what a stack walk, symbolizing and the JS engine's own frames need, with headroom
const LOW_STACK_BYTES = 64 * 1024;

let targetReady = false;

export function markTargetReady(): void {
  targetReady = true;
}

// The first reason the current call is unsafe for a stack trace, or undefined. `ctx` is an Interceptor callback's
// `this.context`; without it (Java hooks) the stack headroom isn't checked.
export function detectUnsafeContext(ctx?: CpuContext): UnsafeContext | undefined {
  if (isOnSignalStack(ctx)) return "signal-stack";
  const tid = Process.getCurrentThreadId();
  if ((linkerDepth.get(tid) ?? 0) > 0) return "in-linker";
  // No thread enters the linker meanwhile: watchLinker()'s callbacks need the JS lock this call holds, and they run
  // before the linker takes its own lock.
  if (linkerDepth.size > 0) return "linker-busy";
  if (ctx && hasLowStack(tid, ctx.sp)) return "low-stack";
  if (!targetReady) return "before-ready";
  return undefined;
}

let sigaltstackFn: NativeFunction<number, [NativePointer, NativePointer]> | null = null;
let sigaltstackResolved = false;
let ossBuffer: NativePointer | null = null;

// Whether the current thread runs on an alternate signal stack (`sigaltstack`)
export function isOnSignalStack(ctx?: CpuContext): boolean {
  if (!sigaltstackResolved) {
    sigaltstackResolved = true;
    try {
      const exportPtr = Process.findModuleByName("libc.so")?.findExportByName("sigaltstack");
      if (exportPtr) {
        sigaltstackFn = new NativeFunction(exportPtr, "int", ["pointer", "pointer"]);
        ossBuffer = Memory.alloc(32);
      }
    } catch (_) {
      sigaltstackFn = null;
    }
  }
  if (!sigaltstackFn || !ossBuffer) return false;
  try {
    if (sigaltstackFn(ptr(0), ossBuffer) === 0) {
      // stack_t: ss_sp, then ss_flags at offset Process.pointerSize, then ss_size
      const flags = ossBuffer.add(Process.pointerSize).readInt();
      // SS_ONSTACK = 1
      if ((flags & 1) !== 0) return true;
      if (ctx?.sp) {
        const ssSp = ossBuffer.readPointer();
        const ssSize = ossBuffer.add(Process.pointerSize * 2).readPointer();
        if (!ssSp.isNull() && !ssSize.isNull() && ctx.sp.compare(ssSp) >= 0 && ctx.sp.compare(ssSp.add(ssSize)) < 0) {
          return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

// dlopen()/dlclose() calls in progress, by thread id
const linkerDepth = new Map<number, number>();
let watchingLinker = false;

// Counts a dlopen()/dlclose() call of thread `tid` until leaveLinker(), see watchLinker()
export function enterLinker(tid: number): void {
  linkerDepth.set(tid, (linkerDepth.get(tid) ?? 0) + 1);
}

export function leaveLinker(tid: number): void {
  const depth = (linkerDepth.get(tid) ?? 1) - 1;
  if (depth > 0) linkerDepth.set(tid, depth);
  else linkerDepth.delete(tid);
}

// Tracks which threads are inside dlopen()/dlclose(). Hooks the linker's entry points, which run before it takes
// its lock, so the callbacks never wait for the JS lock while holding the linker's.
export function watchLinker(): void {
  if (watchingLinker || Process.platform !== "linux") return;
  watchingLinker = true;
  const linker = Process.findModuleByName("linker64");
  if (!linker) return;
  // libdl's dlopen(), android_dlopen_ext() and dlclose() call these; System.loadLibrary() goes through android_dlopen_ext()
  for (const symbol of ["__loader_dlopen", "__loader_android_dlopen_ext", "__loader_dlclose"]) {
    const address = linker.findExportByName(symbol);
    if (!address) continue;
    try {
      Interceptor.attach(address, {
        onEnter() {
          this.linkerTid = Process.getCurrentThreadId();
          enterLinker(this.linkerTid);
        },
        onLeave() {
          leaveLinker(this.linkerTid);
        },
      });
    } catch (_) {}
  }
}

type StackBounds = { low: NativePointer; high: NativePointer };

// stack bounds by thread id, see stackBounds()
const MAX_CACHED_THREADS = 4096;
const stackBoundsCache = new Map<number, StackBounds | null>();
let pthreadFns:
  | {
      self: NativeFunction<NativePointer, []>;
      getattr: NativeFunction<number, [NativePointer, NativePointer]>;
      getstack: NativeFunction<number, [NativePointer, NativePointer, NativePointer]>;
      destroy: NativeFunction<number, [NativePointer]>;
    }
  | null
  | undefined;

function hasLowStack(tid: number, sp: NativePointer): boolean {
  let bounds = stackBoundsCache.get(tid);
  // a thread id reused by a new thread has another stack
  if (bounds === undefined || (bounds !== null && (sp.compare(bounds.low) < 0 || sp.compare(bounds.high) >= 0))) {
    bounds = stackBounds();
    if (stackBoundsCache.size >= MAX_CACHED_THREADS) stackBoundsCache.clear();
    stackBoundsCache.set(tid, bounds);
  }
  // unknown bounds, or `sp` not on the thread's stack (e.g. a coroutine's): not counted as low
  if (bounds === null || sp.compare(bounds.low) < 0 || sp.compare(bounds.high) >= 0) return false;
  // stacks grow down
  return sp.sub(bounds.low).compare(ptr(LOW_STACK_BYTES)) < 0;
}

// The current thread's stack from pthread_getattr_np(), or null if it's unknown
export function stackBounds(): StackBounds | null {
  if (pthreadFns === undefined) {
    pthreadFns = null;
    const libc = Process.findModuleByName("libc.so");
    const self = libc?.findExportByName("pthread_self");
    const getattr = libc?.findExportByName("pthread_getattr_np");
    const getstack = libc?.findExportByName("pthread_attr_getstack");
    const destroy = libc?.findExportByName("pthread_attr_destroy");
    if (self && getattr && getstack && destroy) {
      pthreadFns = {
        self: new NativeFunction(self, "pointer", []),
        getattr: new NativeFunction(getattr, "int", ["pointer", "pointer"]),
        getstack: new NativeFunction(getstack, "int", ["pointer", "pointer", "pointer"]),
        destroy: new NativeFunction(destroy, "int", ["pointer"]),
      };
    }
  }
  if (!pthreadFns) return null;
  try {
    // pthread_attr_t is 56 bytes on 64-bit bionic
    const attr = Memory.alloc(128);
    if (pthreadFns.getattr(pthreadFns.self(), attr) !== 0) return null;
    const addr = Memory.alloc(Process.pointerSize);
    const size = Memory.alloc(Process.pointerSize);
    const result = pthreadFns.getstack(attr, addr, size);
    pthreadFns.destroy(attr);
    if (result !== 0) return null;
    const low = addr.readPointer();
    return { low, high: low.add(size.readPointer()) };
  } catch (_) {
    return null;
  }
}
