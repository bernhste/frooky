import Java from "frida-java-bridge";
import { getAndroidApiLevel, getApi, getArtMethodSpec } from "frida-java-bridge/lib/android.js";
import { logger } from "../shared/logger";

declare module "frida-java-bridge/lib/android.js" {
  // the ArtMethod layout frida-java-bridge detects once and uses for every hook, offsets in bytes
  export function getArtMethodSpec(vm: Java.VM): { size: number; offset: { jniCode: number; quickCode: number; accessFlags: number } };
  export function getAndroidApiLevel(): number;
}

// Adjustments frooky makes to frida-java-bridge 7.0.13 for some Android versions:
// 1. Android 16: hooking an intrinsic or a precompiled boot image method overflows the stack (repairAccessFlags)
// 2. Android 17: Java.backtrace() throws (resolveArtWalkStack)
// 3. Android 17: a GC while a hooked method runs crashes the app (fixArtMethodAccessFlagsOffset)
// 4. Android 12 and 13: hooks on a class that isn't initialized yet miss calls (initializeClass)
// Remove an adjustment once a newer bridge version no longer needs it. They depend on the bridge's internals (the
// `_m` mangler, the memoized ArtMethod spec, its API table), so package.json pins the exact version: when upgrading,
// run javaBridgeWorkarounds.test.ts on Android 15, 16 and 17, and the integration test
// test_constructors_and_static_methods on Android 12 and 13.

// ArtMethod access flags, used by issues 1 and 3
const kAccNative = 0x0100;
// above these bits, an intrinsic's access flags hold its intrinsic ordinal, e.g. 0xb7280009 of Integer.valueOf(int)
const ACCESS_FLAGS_MASK = 0xffff;

// =====================================================================================================================
// Issue 1 - Android 16: hooking an intrinsic or a precompiled boot image method overflows the stack
// =====================================================================================================================

const kAccPreCompiled = 0x00800000; // also kAccPreviouslyWarm, set on boot image methods
const kAccCompileDontBother = 0x02000000;
const kAccIntrinsic = 0x80000000;
const kAccPublicApi = 0x10000000; // hidden API list of JDK methods such as Integer.valueOf()
// their native methods are signature polymorphic, e.g. MethodHandle.invokeExact(): ART dispatches them by their
// intrinsic, so they must stay intrinsics
const SIGNATURE_POLYMORPHIC_CLASSES = new Set(["java.lang.invoke.MethodHandle", "java.lang.invoke.VarHandle"]);

// frida-java-bridge's ArtMethodMangler, kept as `_m` on the replacement implementation
type ArtMethodMangler = { hookedMethodId?: NativePointer; replacementMethodId?: NativePointer; originalMethod?: { accessFlags: number } };

// Issue: hooking an intrinsic or a precompiled boot image method crashes the app with a stack overflow on Android 16.
//
// Repro (Android 16 arm64 emulator, com.google.android.dialer): hook Integer.valueOf(int) and String.equals(Object)
// with `m.implementation = function (...args) { return m.call(this, ...args); }`. Within seconds: SIGSEGV, "stack
// pointer is not in a rw map; likely due to stack overflow", in frida-agent frames.
//
// How it happens: a hook runs through a native copy of the ArtMethod (the replacement), and a call of the original
// goes through only while the caller's frame is the generic JNI trampoline's frame of that copy.
// - The copy has the original's runtime flags plus kAccCompileDontBother, e.g. 0xb7280009 -> 0xb7000109 for
//   Integer.valueOf(int). Android 16's ART ignores kAccCompileDontBother for intrinsics and with kAccPreCompiled set,
//   so the JIT compiles a JNI stub for the copy. Its frame isn't the trampoline's frame, so each call of the original
//   runs the hook again until the stack overflows.
// - Hooking clears and sets runtime flags of the original (0xb7280009 -> 0xb7200009). In an intrinsic these bits
//   hold the intrinsic ordinal, so ART runs another intrinsic's code for it.
//
// frooky runs into this because a hook file can hook any method, including JDK intrinsics such as String.equals()
// that the app and the framework call all the time.
//
// Fix: the copy gets only the low access flags plus kAccCompileDontBother, without kAccIntrinsic, its ordinal and
// kAccPreCompiled. A hooked intrinsic becomes a plain public API method with kAccCompileDontBother, as ART would
// still compile an intrinsic and code compiled afterwards would inline it, both skipping the hook. Unhooking
// restores its flags. The signature polymorphic methods of MethodHandle and VarHandle are left alone. Call after
// setting `implementation`, and after fixArtMethodAccessFlagsOffset() (issue 3), whose offset it uses.
// `target`: e.g. `java.lang.Integer.reverse`, for messages
export function repairAccessFlags(method: Java.Method, target: string): void {
  const mangler = (method.implementation as { _m?: ArtMethodMangler } | null)?._m;
  const { hookedMethodId, replacementMethodId, originalMethod } = mangler ?? {};
  if (!hookedMethodId || !replacementMethodId || !originalMethod) return;
  const originalFlags = originalMethod.accessFlags >>> 0;
  if ((originalFlags & kAccNative) !== 0 && SIGNATURE_POLYMORPHIC_CLASSES.has(method.holder.$className)) {
    logger.debug(`Kept the access flags of ${target}: signature polymorphic`);
    return;
  }
  const accessFlagsOffset = getArtMethodSpec(Java.vm).offset.accessFlags;
  const replacementFlags = replacementMethodId.add(accessFlagsOffset);
  const flags = replacementFlags.readU32() >>> 0;
  if ((flags & kAccNative) === 0) {
    logger.debug(`Unexpected ArtMethod layout of the replacement of ${target}`);
    return;
  }
  const isIntrinsic = (originalFlags & kAccIntrinsic) !== 0;
  const runtimeFlags = isIntrinsic ? flags & ACCESS_FLAGS_MASK : flags & ~kAccPreCompiled;
  const repairedFlags = (runtimeFlags | kAccCompileDontBother) >>> 0;
  if (repairedFlags !== flags) {
    replacementFlags.writeU32(repairedFlags);
    logger.debug(`Access flags of the replacement of ${target}: 0x${flags.toString(16)} -> 0x${repairedFlags.toString(16)}`);
  }
  if (isIntrinsic) {
    const hookedFlags = ((originalFlags & ACCESS_FLAGS_MASK) | kAccPublicApi | kAccCompileDontBother) >>> 0;
    hookedMethodId.add(accessFlagsOffset).writeU32(hookedFlags);
    logger.debug(`Access flags of the intrinsic ${target}: 0x${originalFlags.toString(16)} -> 0x${hookedFlags.toString(16)}`);
  }
}

// =====================================================================================================================
// Issue 2 - Android 17: Java.backtrace() throws
// =====================================================================================================================

// StackVisitor::WalkStack<CountTransitions::kYes, false>(bool) of Android 17's ART
const WALK_STACK_WITH_FLAG_SYMBOL = "_ZN3art12StackVisitor9WalkStackILNS0_16CountTransitionsE0ELb0EEEvb";

// Issue: Java.backtrace() throws on Android 17.
//
// Repro (Android 17 x86_64 emulator, com.google.android.dialer): `Java.perform(() => Java.backtrace())` throws
// "Error: expected a pointer" at makeBacktraceModule (lib/android.js). Android 15 and 16 return the frames.
//
// How it happens: Android 17's ART adds a template parameter to StackVisitor::WalkStack(). libart.so exports
// WALK_STACK_WITH_FLAG_SYMBOL instead of _ZN3art12StackVisitor9WalkStackILNS0_16CountTransitionsE0EEEvb, the name
// lib/android.js looks up, so api['art::StackVisitor::WalkStack'] is undefined and the backtrace CModule can't be
// created.
//
// frooky runs into this on every Java hook with `platformStackTrace: true` or a `callerFilter`: without it, the
// stack traces are empty and the callerFilter drops every call.
//
// Fix: look up the new name too, and fill it into the bridge's API before the first Java.backtrace().
export function resolveArtWalkStack(): void {
  const api = getApi();
  if (api === null || api["art::StackVisitor::WalkStack"] !== undefined) return;
  const address = Process.findModuleByName("libart.so")?.findExportByName(WALK_STACK_WITH_FLAG_SYMBOL);
  if (!address) return;
  api["art::StackVisitor::WalkStack"] = new NativeFunction(address, "void", ["pointer", "bool"], { exceptions: "propagate" });
  logger.debug("Java backtraces use StackVisitor::WalkStack<kYes, false>() of libart.so");
}

// =====================================================================================================================
// Issue 3 - Android 17: a GC while a hooked method runs crashes the app
// =====================================================================================================================

const kAccPublic = 0x0001;
const kAccStatic = 0x0008;
const kAccFinal = 0x0010;
// Modifiers of android.os.Process.getElapsedCpuTime(), the method frida-java-bridge detects the access flags offset with
const GET_ELAPSED_CPU_TIME_MODIFIERS = kAccPublic | kAccStatic | kAccFinal | kAccNative;

let artMethodSpecFixed = false;

// Issue: on Android 17, a GC that walks a thread while it is inside a hooked method crashes the app.
//
// Repro (Android 17 x86_64 emulator, com.google.android.dialer): hook HashMap.get(Object) with
// `m.implementation = function (...args) { return m.call(this, ...args); }` and trigger GCs (`kill -USR1 <pid>`).
// Within seconds: SIGSEGV, null pointer dereference in art::CodeInfo::DecodeGcMasksOnly(), called by
// ReferenceMapVisitor::VisitFrame() in StackVisitor::WalkStack() from MarkCompact::CheckpointMarkThreadRoots.
// Without a hook, `Runtime.getRuntime().gc()` from Java.perform() crashes the same way in spawn mode, as spawning
// hooks ActivityThread.handleBindApplication() to run Java.perform() callbacks once the app is ready.
//
// How it happens: on Android 17, getArtMethodSpec() returns 36 as the access flags offset, beyond the 32-byte
// ArtMethod, instead of 4. It looks for the first 32-bit word of getElapsedCpuTime()'s ArtMethod that equals `public
// static final native` once kAccFastInterpreterToInterpreterInvoke, kAccPublicApi and kAccNterpInvokeFastPathFlag
// are masked out. Android 17 also sets kAccNterpEntryPointFastPathFlag (0x00100000) on that native method:
// 0x50300119 instead of 0x50200119 of Android 15 and 16. Offset 4 doesn't match, and the scan matches the flags of
// the next ArtMethod in the class. Every access flags change then lands 4 bytes into the next ArtMethod (or past the
// replacement's heap block), and the hooked method's original flags are read from there:
// - The replacement keeps the original's flags without kAccNative. A GC that walks a thread inside the hook finds
//   the replacement's generic JNI frame, takes it for compiled code and decodes the GC maps of a null method header.
// - The flags of the next method in the class change, and unhooking writes the flags read from there back.
//
// frooky can run into this on any Java hook on Android 17: hot methods (e.g. HashMap.get) crash within seconds,
// rarely called ones only if a GC happens to run while they are on a stack.
//
// Fix: compare only the low 16 bits (the Java modifiers) of each word within the ArtMethod. The first match is the
// access flags at offset 4: offset 0 holds the 32-bit reference to the declaring class, which is 8-byte aligned and
// so never matches the odd modifiers. The offset in the bridge's memoized spec is set to it before the first
// Java.perform() and hook. A hook installed before has its flags written to the other offset, and unhooking it then
// writes those flags back, so that is logged as an error. Skipped for opaque jmethodIDs (ART's index IDs, odd
// values), which only the bridge can decode.
export function fixArtMethodAccessFlagsOffset(): void {
  if (artMethodSpecFixed) return;
  artMethodSpecFixed = true;
  const spec = getArtMethodSpec(Java.vm);
  Java.vm.perform(() => {
    const env = Java.vm.getEnv();
    const processClass = env.findClass("android/os/Process");
    const methodId: NativePointer = env.getStaticMethodId(processClass, "getElapsedCpuTime", "()J");
    env.deleteLocalRef(processClass);
    if (!methodId.and(1).isNull()) return;
    for (let offset = 0; offset < spec.size; offset += 4) {
      if ((methodId.add(offset).readU32() & ACCESS_FLAGS_MASK) !== GET_ELAPSED_CPU_TIME_MODIFIERS) continue;
      if (offset !== spec.offset.accessFlags) {
        logger.debug(`ArtMethod access flags are at offset ${offset}, frida-java-bridge detected ${spec.offset.accessFlags}`);
        const hookedBefore = (Java.classFactory as unknown as { _patchedMethods?: Set<unknown> })._patchedMethods?.size ?? 0;
        if (hookedBefore > 0) {
          logger.error(
            `${hookedBefore} method(s) were hooked before the ArtMethod access flags offset was set to ${offset}, unhooking them corrupts their access flags`,
          );
        }
        spec.offset.accessFlags = offset;
      }
      return;
    }
  });
}

// =====================================================================================================================
// Issue 4 - Android 12 and 13: hooks on a class that isn't initialized yet miss calls
// =====================================================================================================================

// the API levels of Android 12, 12L and 13
const UNINITIALIZED_CLASS_API_LEVELS = { min: 31, max: 33 };

// Issue: hooks installed on a class that isn't initialized yet miss calls on Android 12 and 13.
//
// Repro (Android 12 and 13 arm64 emulators, value_passing_java.frooky.target.app): spawn it, hook
// MastgTestKt.receiveStatic(String) and Secret.<init>(String) with `m.implementation = function (...args) { return
// m.call(this, ...args); }` and press "Start" 8 times. Android 12: only the first call of receiveStatic() runs the
// hook, Secret.<init> never. Android 13: every call but the first of Secret.<init>, the one that initializes the
// class. Android 14 and 15: every call. Attached after the classes are initialized, every call on all of them.
//
// How it happens: not pinned down. ART initializes a class on its first active use, e.g. `new`, a static call or a
// static field access, and the hooks installed before miss the calls from then on, presumably because the class's
// methods get their entry points set up again.
//
// frooky runs into this on most hooks on the app's own classes: it hooks them as soon as they are found, at targetReady
// or when their class loader is created, and the app initializes them when it first uses them, often much later.
//
// Fix: initialize the class with Class.forName(name, true, loader) before its first hook. This runs its static
// initializer earlier than the app would, on frooky's thread. Does nothing for a class that is already initialized,
// e.g. most framework classes. Call before setting `implementation`.
const initializedClasses = new WeakSet<Java.Wrapper>();

export function initializeClass(method: Java.Method): void {
  const apiLevel = getAndroidApiLevel();
  if (apiLevel < UNINITIALIZED_CLASS_API_LEVELS.min || apiLevel > UNINITIALIZED_CLASS_API_LEVELS.max) return;
  const holder = method.holder;
  if (initializedClasses.has(holder)) return;
  initializedClasses.add(holder);
  const className = holder.$className;
  try {
    Java.use("java.lang.Class").forName(className, true, holder.class.getClassLoader());
    logger.debug(`${className} is initialized before hooking it`);
  } catch (e) {
    logger.warn(`Couldn't initialize ${className} before hooking it, its hooks may miss calls: ${e}`);
  }
}
